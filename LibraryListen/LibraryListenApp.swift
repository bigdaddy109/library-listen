import SwiftUI

@main
struct LibraryListenApp: App {
    @State private var session = LibrarySession()
    @State private var player = PlayerController()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environment(session)
                .environment(player)
                .environment(ProgressStore.shared)
                .preferredColorScheme(.dark)
                .tint(ListenTheme.amber)
                .task {
                    player.configureSession()
                    session.restore()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase != .active {
                        player.persistNow()
                    }
                }
        }
    }
}