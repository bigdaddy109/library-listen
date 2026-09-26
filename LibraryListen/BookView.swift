import SwiftUI

struct BookView: View {
    let book: Audiobook
    var startContinuing = false

    @Environment(PlayerController.self) private var player
    @Environment(ProgressStore.self) private var progressStore
    @State private var didAutoplay = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(book.author)
                    .foregroundStyle(ListenTheme.muted)
                Text("\(book.chapterCount) chapters · \(book.audioFormat.uppercased())")
                    .font(.subheadline)
                    .foregroundStyle(ListenTheme.muted)

                if let progress = progressStore.progress(for: book.id) {
                    let status = shelfProgressStatus(book: book, progress: progress, player: player)
                    Button {
                        player.playOrResume(book)
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Continue listening")
                                .font(.headline)
                            Text(status.line)
                                .font(.caption)
                                .foregroundStyle(ListenTheme.amber.opacity(0.9))
                            if let fraction = status.fraction {
                                ListenProgressBar(fraction: fraction)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                    }
                    .background(ListenTheme.amber.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
                    .foregroundStyle(ListenTheme.amber)
                }

                ForEach(book.chapters) { chapter in
                    chapterRow(chapter)
                }
            }
            .padding(20)
            .padding(.bottom, 140)
        }
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.large)
        .onAppear {
            guard startContinuing, !didAutoplay else { return }
            didAutoplay = true
            player.playOrResume(book)
        }
    }

    private func chapterRow(_ chapter: Chapter) -> some View {
        let progress = progressStore.progress(for: book.id)
        let isLeftOff = progress?.chapterId == chapter.id
        let isCurrent = player.book?.id == book.id && player.chapter?.id == chapter.id
        return Button {
            open(chapter, progress: progress)
        } label: {
            HStack(spacing: 12) {
                Text(String(format: "%02d", chapter.index))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(ListenTheme.muted)
                    .frame(width: 28, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(chapter.title)
                        .foregroundStyle(isLeftOff ? ListenTheme.amber : ListenTheme.ink)
                        .multilineTextAlignment(.leading)
                    if isLeftOff, let progress {
                        Text("Left off · \(relativeTime(progress.updatedAt))")
                            .font(.caption)
                            .foregroundStyle(ListenTheme.amber)
                    } else if isCurrent {
                        Text(player.isPlaying ? "Playing" : "Paused")
                            .font(.caption)
                            .foregroundStyle(ListenTheme.amber)
                    }
                }
                Spacer()
                Text(trailingClock(chapter, progress: progress, isLeftOff: isLeftOff))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(isLeftOff ? ListenTheme.amber : ListenTheme.muted)
            }
            .padding(12)
            .background(
                (isLeftOff || isCurrent) ? ListenTheme.amber.opacity(0.14) : ListenTheme.card,
                in: RoundedRectangle(cornerRadius: 12)
            )
        }
        .buttonStyle(.plain)
    }

    private func trailingClock(_ chapter: Chapter, progress: ProgressRecord?, isLeftOff: Bool) -> String {
        if isLeftOff, let progress {
            return savedChapterClock(book: book, chapter: chapter, progress: progress, player: player)
        }
        return formatClock(chapter.duration)
    }

    private func open(_ chapter: Chapter, progress: ProgressRecord?) {
        if player.book?.id == book.id, player.chapter?.id == chapter.id {
            if !player.isPlaying {
                player.toggle()
            }
            return
        }
        if let progress, progress.chapterId == chapter.id {
            player.play(book: book, chapter: chapter, position: progress.positionSeconds, autoplay: true)
            return
        }
        player.play(book: book, chapter: chapter, position: chapter.start, autoplay: true)
    }
}
