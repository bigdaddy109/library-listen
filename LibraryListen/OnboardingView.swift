import SwiftUI

struct OnboardingView: View {
    @Environment(LibrarySession.self) private var session
    @State private var picking = false

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Spacer()
            Text("Library Listen")
                .font(.system(size: 40, weight: .regular, design: .serif))
            Text("Play Munroe and Immune from Main Hub folders already on this iPhone or iPad via iCloud Drive. Pick one folder or several. No TTS.")
                .font(.body)
                .foregroundStyle(ListenTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 10) {
                step("1", "In Files, open iCloud Drive → Main Hub → … → Daryl Stuff → Library.")
                step("2", "Download Now on any cloud-only files you need for the commute.")
                step("3", "Pick that Library folder once (or add 門羅-WhatIf and Immune). The app remembers it.")
            }

            Text("""
            Munroe: \(HubPaths.macMunroeListen)
            Immune: \(HubPaths.macImmuneListen)
            """)
                .font(.caption)
                .foregroundStyle(ListenTheme.muted)
                .textSelection(.enabled)

            Button {
                picking = true
            } label: {
                Text("Choose a Hub folder")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
            .buttonStyle(.borderedProminent)
            .tint(ListenTheme.amber)
            .foregroundStyle(Color.black)

            Button("Use bundled sample (silent stubs)") {
                Task { await session.useBundledSample() }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .foregroundStyle(ListenTheme.amber)

            if let error = session.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            Spacer()
        }
        .padding(24)
        .sheet(isPresented: $picking) {
            FolderPicker(
                onPick: { url in
                    picking = false
                    Task { @MainActor in
                        session.retainPickedAccess(url, replacing: true)
                        await session.openPickedFolder(url, adding: false)
                    }
                },
                onCancel: { picking = false }
            )
            .ignoresSafeArea()
        }
    }

    private func step(_ number: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number)
                .font(.headline)
                .foregroundStyle(ListenTheme.amber)
                .frame(width: 22)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(ListenTheme.ink)
        }
    }
}
