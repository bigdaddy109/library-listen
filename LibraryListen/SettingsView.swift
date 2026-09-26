import SwiftUI

struct SettingsView: View {
    @Environment(LibrarySession.self) private var session
    @State private var picking = false
    @State private var adding = false

    var body: some View {
        List {
            Section("Folders in use") {
                if session.rootURLs.isEmpty {
                    Text("None")
                } else {
                    ForEach(session.rootURLs, id: \.path) { url in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(url.path)
                                .font(.footnote)
                                .textSelection(.enabled)
                            Button("Remove this folder", role: .destructive) {
                                Task { await session.removeRoot(url) }
                            }
                        }
                    }
                }
                Text(session.source == .bundledSample ? "Bundled sample" : "Files / iCloud Drive bookmarks")
                    .foregroundStyle(ListenTheme.muted)
            }

            Section("Verified Mac Hub paths") {
                labeledPath("Munroe", HubPaths.macMunroeListen)
                labeledPath("Immune", HubPaths.macImmuneListen)
                Text("Immune is nine files: Immune-Part01.mp3 … Immune-Part09.mp3, sitting directly in Library/Immune/listen/. Pick the Library folder to scan both trees.")
                    .font(.footnote)
                    .foregroundStyle(ListenTheme.muted)
            }

            Section("Offline commute") {
                Text("iCloud Drive already syncs Main Hub. If a chapter has a cloud icon, tap Download Now in Files before you leave Wi‑Fi. The Mac does not need to be running.")
                    .font(.footnote)
                    .foregroundStyle(ListenTheme.muted)
            }

            Section {
                Button("Add another folder") {
                    adding = true
                    picking = true
                }
                Button("Replace with one folder") {
                    adding = false
                    picking = true
                }
                Button("Use bundled silent sample") {
                    Task { await session.useBundledSample() }
                }
                Button("Forget all folders", role: .destructive) {
                    session.forgetFolders()
                }
            }
        }
        .navigationTitle("Folders")
        .sheet(isPresented: $picking) {
            FolderPicker(
                onPick: { url in
                    let add = adding
                    picking = false
                    Task { @MainActor in
                        session.retainPickedAccess(url, replacing: !add)
                        await session.openPickedFolder(url, adding: add)
                    }
                },
                onCancel: { picking = false }
            )
            .ignoresSafeArea()
        }
    }

    private func labeledPath(_ title: String, _ path: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
            Text(path)
                .font(.footnote)
                .textSelection(.enabled)
        }
    }
}