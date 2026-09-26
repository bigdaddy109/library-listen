import SwiftUI

struct AppRootView: View {
    @Environment(LibrarySession.self) private var session

    var body: some View {
        Group {
            if session.hasLibrary {
                libraryStack
            } else {
                OnboardingView()
            }
        }
        .background(ListenTheme.background.ignoresSafeArea())
    }

    private var libraryStack: some View {
        NavigationStack {
            ShelfView()
                .navigationDestination(for: Audiobook.self) { book in
                    BookView(book: book)
                }
        }
        .safeAreaInset(edge: .bottom) {
            PlayerBar()
        }
    }
}