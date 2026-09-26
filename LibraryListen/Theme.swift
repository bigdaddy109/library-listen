import SwiftUI

enum ListenTheme {
    static let background = Color(red: 0.10, green: 0.09, blue: 0.07)
    static let card = Color(red: 0.16, green: 0.14, blue: 0.12)
    static let ink = Color(red: 0.96, green: 0.94, blue: 0.88)
    static let muted = Color(red: 0.68, green: 0.64, blue: 0.56)
    static let amber = Color(red: 0.91, green: 0.68, blue: 0.28)
}

func formatClock(_ seconds: TimeInterval?) -> String {
    guard let seconds, seconds.isFinite, seconds >= 0 else { return "0:00" }
    let total = Int(seconds.rounded(.down))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let rest = total % 60
    if hours > 0 {
        return "\(hours):\(String(format: "%02d", minutes)):\(String(format: "%02d", rest))"
    }
    return "\(minutes):\(String(format: "%02d", rest))"
}

func relativeTime(_ date: Date) -> String {
    let elapsed = max(0, Date().timeIntervalSince(date))
    let minutes = Int(elapsed / 60)
    if minutes < 1 { return "just now" }
    if minutes < 60 { return "\(minutes)m ago" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h ago" }
    if hours < 48 { return "yesterday" }
    return "\(hours / 24)d ago"
}

func resolvedChapterDuration(chapter: Chapter, saved: Double?) -> TimeInterval? {
    if let saved, saved > 0, saved.isFinite { return saved }
    if let end = chapter.end {
        let span = end - chapter.start
        if span > 0, span.isFinite { return span }
    }
    if let duration = chapter.duration, duration > 0, duration.isFinite { return duration }
    return nil
}

func chapterRelativePosition(book: Audiobook, chapter: Chapter, filePosition: Double) -> TimeInterval {
    let raw = book.kind == .audiobook ? filePosition - chapter.start : filePosition
    guard raw.isFinite else { return 0 }
    return max(0, raw)
}

func progressFraction(position: TimeInterval, duration: TimeInterval?) -> Double? {
    guard let duration, duration > 0, duration.isFinite, position.isFinite else { return nil }
    return min(1, max(0, position / duration))
}

func progressStatusLine(
    title: String,
    position: TimeInterval,
    duration: TimeInterval?,
    updatedAt: Date?
) -> String {
    var text = "\(title) · \(formatClock(position))"
    if let duration, duration > 0 {
        text += " / \(formatClock(duration))"
    }
    if let updatedAt {
        text += " · \(relativeTime(updatedAt))"
    }
    return text
}

struct ShelfProgressStatus {
    var line: String
    var fraction: Double?
}

@MainActor
func shelfProgressStatus(
    book: Audiobook,
    progress: ProgressRecord,
    player: PlayerController
) -> ShelfProgressStatus {
    let isLive = player.isPlaying && player.book?.id == book.id && player.chapter != nil
    if isLive, let chapter = player.chapter {
        let position = player.displayPosition
        let duration = liveChapterDuration(player: player, chapter: chapter, progress: progress)
        return ShelfProgressStatus(
            line: progressStatusLine(title: chapter.title, position: position, duration: duration, updatedAt: nil),
            fraction: progressFraction(position: position, duration: duration)
        )
    }
    let chapter = book.chapters.first(where: { $0.id == progress.chapterId })
    let title = chapter?.title ?? "Chapter"
    let position = chapter.map {
        chapterRelativePosition(book: book, chapter: $0, filePosition: progress.positionSeconds)
    } ?? max(0, progress.positionSeconds)
    let duration = chapter.flatMap {
        resolvedChapterDuration(chapter: $0, saved: progress.chapterDurationSeconds)
    } ?? positiveDuration(progress.chapterDurationSeconds)
    return ShelfProgressStatus(
        line: progressStatusLine(title: title, position: position, duration: duration, updatedAt: progress.updatedAt),
        fraction: progressFraction(position: position, duration: duration)
    )
}

@MainActor
func savedChapterClock(
    book: Audiobook,
    chapter: Chapter,
    progress: ProgressRecord,
    player: PlayerController
) -> String {
    let isLive = player.book?.id == book.id && player.chapter?.id == chapter.id
    let position: TimeInterval
    let duration: TimeInterval?
    if isLive {
        position = player.displayPosition
        duration = liveChapterDuration(player: player, chapter: chapter, progress: progress)
    } else {
        position = chapterRelativePosition(book: book, chapter: chapter, filePosition: progress.positionSeconds)
        duration = resolvedChapterDuration(chapter: chapter, saved: progress.chapterDurationSeconds)
    }
    if let duration, duration > 0 {
        return "\(formatClock(position)) / \(formatClock(duration))"
    }
    return formatClock(position)
}

@MainActor
private func liveChapterDuration(
    player: PlayerController,
    chapter: Chapter,
    progress: ProgressRecord
) -> TimeInterval? {
    if player.displayDuration > 0 { return player.displayDuration }
    guard player.chapter?.id == progress.chapterId else { return nil }
    return resolvedChapterDuration(chapter: chapter, saved: progress.chapterDurationSeconds)
}

private func positiveDuration(_ value: Double?) -> TimeInterval? {
    guard let value, value > 0, value.isFinite else { return nil }
    return value
}

struct ListenProgressBar: View {
    var fraction: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(ListenTheme.amber.opacity(0.22))
                Capsule()
                    .fill(ListenTheme.amber)
                    .frame(width: proxy.size.width * min(1, max(0, fraction)))
            }
        }
        .frame(height: 3)
        .accessibilityHidden(true)
    }
}