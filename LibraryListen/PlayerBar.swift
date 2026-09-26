import SwiftUI

struct PlayerBar: View {
    @Environment(PlayerController.self) private var player

    var body: some View {
        if player.book != nil, player.chapter != nil {
            Group {
                if player.isExpanded {
                    expandedBar
                } else {
                    miniBar
                }
            }
            .background(.ultraThinMaterial)
        }
    }

    private var miniBar: some View {
        HStack(spacing: 12) {
            titles
            Spacer(minLength: 8)
            playPauseButton(size: 40, symbol: 16)
            Button {
                player.expandPlayer()
            } label: {
                Image(systemName: "chevron.up")
                    .font(.body.weight(.semibold))
                    .frame(width: 36, height: 36)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Expand player")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .gesture(swipeToExpand)
        .foregroundStyle(ListenTheme.ink)
    }

    private var expandedBar: some View {
        VStack(spacing: 10) {
            Capsule()
                .fill(ListenTheme.muted.opacity(0.45))
                .frame(width: 36, height: 4)
                .padding(.top, 6)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .gesture(swipeToCollapse)
                .accessibilityHidden(true)

            HStack(alignment: .center, spacing: 10) {
                titles
                Spacer(minLength: 8)
                Button(rateLabel) {
                    cycleRate()
                }
                .font(.caption.monospacedDigit().weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(ListenTheme.card, in: Capsule())
                Button {
                    player.collapsePlayer()
                } label: {
                    Image(systemName: "chevron.down")
                        .font(.body.weight(.semibold))
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("Collapse player")
            }
            .contentShape(Rectangle())
            .gesture(swipeToCollapse)

            Slider(
                value: Binding(
                    get: { player.displayPosition },
                    set: { player.seekDisplay($0) }
                ),
                in: 0...max(player.displayDuration, 0.1)
            )
            .tint(ListenTheme.amber)

            HStack {
                Text(formatClock(player.displayPosition))
                Spacer()
                Text(formatClock(player.displayDuration))
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(ListenTheme.muted)

            HStack(spacing: 28) {
                Button {
                    player.skipChapter(-1)
                } label: {
                    Image(systemName: "backward.fill")
                        .font(.title2)
                        .frame(width: 48, height: 48)
                }
                .accessibilityLabel("Previous chapter")

                playPauseButton(size: 64, symbol: 22)

                Button {
                    player.skipChapter(1)
                } label: {
                    Image(systemName: "forward.fill")
                        .font(.title2)
                        .frame(width: 48, height: 48)
                }
                .accessibilityLabel("Next chapter")
            }

            Button(role: .destructive) {
                player.stopAndClear()
            } label: {
                Text("Stop and hide")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .accessibilityHint("Stops playback and removes the player from the shelf.")

            if let error = player.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .foregroundStyle(ListenTheme.ink)
    }

    private var titles: some View {
        Button {
            if !player.isExpanded {
                player.expandPlayer()
            }
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(player.chapter?.title ?? "")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(player.book?.title ?? "")
                    .font(.caption)
                    .foregroundStyle(ListenTheme.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(player.isExpanded)
        .accessibilityHint(player.isExpanded ? "" : "Expands the player")
    }

    private func playPauseButton(size: CGFloat, symbol: CGFloat) -> some View {
        Button {
            player.toggle()
        } label: {
            Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                .font(.system(size: symbol, weight: .semibold))
                .frame(width: size, height: size)
                .background(ListenTheme.amber, in: Circle())
                .foregroundStyle(.black)
        }
        .accessibilityLabel(player.isPlaying ? "Pause" : "Play")
    }

    private var swipeToCollapse: some Gesture {
        DragGesture(minimumDistance: 20)
            .onEnded { value in
                if value.translation.height > 40 {
                    player.collapsePlayer()
                }
            }
    }

    private var swipeToExpand: some Gesture {
        DragGesture(minimumDistance: 20)
            .onEnded { value in
                if value.translation.height < -40 {
                    player.expandPlayer()
                }
            }
    }

    private var rateLabel: String {
        if player.rate == 1 { return "1.0×" }
        if player.rate == 1.25 { return "1.25×" }
        return String(format: "%.1f×", player.rate)
    }

    private func cycleRate() {
        let rates: [Float] = [1, 1.25, 1.5]
        let index = rates.firstIndex(of: player.rate) ?? 0
        player.setRate(rates[(index + 1) % rates.count])
    }
}
