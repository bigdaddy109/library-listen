import AVFoundation
import MediaPlayer
import Observation

@MainActor
@Observable
final class PlayerController {
    var book: Audiobook?
    var chapter: Chapter?
    var isPlaying = false
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var rate: Float = 1
    var errorMessage: String?
    /// Full transport when true; compact title + play/pause when false.
    var isExpanded = true

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var lastSave: TimeInterval = 0
    private var seeking = false

    var displayPosition: TimeInterval {
        guard let chapter else { return currentTime }
        if book?.kind == .audiobook {
            return max(0, currentTime - chapter.start)
        }
        return currentTime
    }

    var displayDuration: TimeInterval {
        guard let chapter else { return duration }
        if let end = chapter.end {
            return max(0, end - chapter.start)
        }
        if book?.kind == .audiobook {
            return max(0, duration - chapter.start)
        }
        return duration > 0 ? duration : (chapter.duration ?? 0)
    }

    func configureSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [])
            try session.setActive(true)
        } catch {
            errorMessage = error.localizedDescription
        }
        remoteCommands()
    }

    func play(book: Audiobook, chapter: Chapter, position: TimeInterval? = nil, autoplay: Bool = true) {
        self.book = book
        self.chapter = chapter
        isExpanded = true
        errorMessage = nil
        do {
            try ICloudFiles.ensureLocal(chapter.fileURL)
        } catch {
            errorMessage = "This chapter is still in iCloud. In Files, tap Download Now on Library/, then try again. \(error.localizedDescription)"
        }

        let item = AVPlayerItem(url: chapter.fileURL)
        if player == nil {
            player = AVPlayer(playerItem: item)
            attachTimeObserver()
        } else if player?.currentItem?.url != chapter.fileURL {
            player?.replaceCurrentItem(with: item)
        }

        let seekTo = position ?? chapter.start
        seek(toFileTime: seekTo)
        player?.rate = rate
        if autoplay {
            player?.play()
            isPlaying = true
        }
        updateNowPlaying()
        attachEndObserver()
        saveProgress(force: true)
    }

    func playOrResume(_ book: Audiobook) {
        if let progress = ProgressStore.shared.progress(for: book.id),
           let saved = book.chapters.first(where: { $0.id == progress.chapterId })
        {
            if self.book?.id == book.id, chapter?.id == saved.id {
                if !isPlaying { toggle() }
                return
            }
            play(book: book, chapter: saved, position: progress.positionSeconds, autoplay: true)
            return
        }
        guard let first = book.chapters.first else { return }
        play(book: book, chapter: first, position: first.start, autoplay: true)
    }

    func toggle() {
        guard let player else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
            saveProgress(force: true)
        } else if let book, let chapter {
            play(book: book, chapter: chapter, position: currentTime, autoplay: true)
        }
    }

    func expandPlayer() {
        isExpanded = true
    }

    func collapsePlayer() {
        isExpanded = false
    }

    func toggleExpanded() {
        isExpanded.toggle()
    }

    /// Pause, save, clear Now Playing, and hide the player chrome.
    func stopAndClear() {
        saveProgress(force: true)
        player?.pause()
        isPlaying = false
        if let observer = timeObserver {
            player?.removeTimeObserver(observer)
            timeObserver = nil
        }
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        player?.replaceCurrentItem(with: nil)
        player = nil
        book = nil
        chapter = nil
        currentTime = 0
        duration = 0
        errorMessage = nil
        isExpanded = true
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    func skipChapter(_ direction: Int) {
        guard let book, let chapter,
              let index = book.chapters.firstIndex(of: chapter)
        else { return }
        if direction < 0, displayPosition > 3 {
            play(book: book, chapter: chapter, position: chapter.start, autoplay: isPlaying)
            return
        }
        let next = index + direction
        guard book.chapters.indices.contains(next) else { return }
        play(book: book, chapter: book.chapters[next], position: book.chapters[next].start, autoplay: isPlaying || true)
    }

    func seekDisplay(_ value: TimeInterval) {
        guard let chapter else { return }
        let fileTime = book?.kind == .audiobook ? chapter.start + value : value
        seek(toFileTime: fileTime)
        saveProgress(force: true)
    }

    func setRate(_ next: Float) {
        rate = next
        if isPlaying {
            player?.rate = next
        }
        updateNowPlaying()
    }

    func persistNow() {
        saveProgress(force: true)
    }

    private func seek(toFileTime time: TimeInterval) {
        seeking = true
        currentTime = time
        let cm = CMTime(seconds: max(0, time), preferredTimescale: 600)
        player?.seek(to: cm, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            Task { @MainActor in
                self?.seeking = false
            }
        }
    }

    private func attachTimeObserver() {
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
        }
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            Task { @MainActor in
                self?.handleTime(CMTimeGetSeconds(time))
            }
        }
    }

    private func attachEndObserver() {
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
        }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player?.currentItem,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.advanceAfterEnd()
            }
        }
    }

    private func handleTime(_ time: TimeInterval) {
        guard time.isFinite else { return }
        if !seeking {
            currentTime = time
        }
        if let itemDuration = player?.currentItem?.duration {
            let seconds = CMTimeGetSeconds(itemDuration)
            if seconds.isFinite, seconds > 0 {
                duration = seconds
            }
        }
        if let book, book.kind == .audiobook, let match = chapter(at: time), match.id != chapter?.id {
            chapter = match
            updateNowPlaying()
            saveProgress(force: true)
            return
        }
        saveProgress(force: false)
        updateNowPlayingElapsed()
    }

    private func chapter(at time: TimeInterval) -> Chapter? {
        guard let book else { return nil }
        if book.kind != .audiobook { return chapter }
        for (index, item) in book.chapters.enumerated() {
            let nextStart = book.chapters.indices.contains(index + 1)
                ? book.chapters[index + 1].start
                : TimeInterval.greatestFiniteMagnitude
            let end = item.end ?? nextStart
            if time >= item.start && time < end {
                return item
            }
        }
        return book.chapters.last
    }

    private func advanceAfterEnd() {
        guard let book, let chapter,
              let index = book.chapters.firstIndex(of: chapter)
        else {
            isPlaying = false
            return
        }
        let next = index + 1
        if book.chapters.indices.contains(next) {
            play(book: book, chapter: book.chapters[next], position: book.chapters[next].start, autoplay: true)
        } else {
            isPlaying = false
            saveProgress(force: true)
        }
    }

    private func saveProgress(force: Bool) {
        guard let book, let chapter else { return }
        let now = Date().timeIntervalSince1970
        if !force, now - lastSave < 2 { return }
        lastSave = now
        ProgressStore.shared.save(
            bookId: book.id,
            chapterId: chapter.id,
            positionSeconds: currentTime,
            chapterDurationSeconds: displayDuration > 0 ? displayDuration : nil
        )
    }

    private func remoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggleIfNeeded(play: true) }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggleIfNeeded(play: false) }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.toggle() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skipChapter(1) }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skipChapter(-1) }
            return .success
        }
    }

    private func toggleIfNeeded(play: Bool) {
        if play, !isPlaying { toggle() }
        if !play, isPlaying { toggle() }
    }

    private func updateNowPlaying() {
        guard let book, let chapter else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: chapter.title,
            MPMediaItemPropertyAlbumTitle: book.title,
            MPMediaItemPropertyArtist: book.author,
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? rate : 0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: displayPosition,
            MPMediaItemPropertyPlaybackDuration: displayDuration,
        ]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func updateNowPlayingElapsed() {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else {
            updateNowPlaying()
            return
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = displayPosition
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

private extension AVPlayerItem {
    var url: URL? {
        (asset as? AVURLAsset)?.url
    }
}