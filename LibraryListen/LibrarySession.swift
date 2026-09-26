import Foundation
import Observation

@MainActor
@Observable
final class LibrarySession {
    var books: [Audiobook] = []
    var rootURLs: [URL] = []
    var source: BookmarkStore.Source = .files
    var isScanning = false
    var errorMessage: String?
    private var accessingFlags: [String: Bool] = [:]

    var rootURL: URL? { rootURLs.first }
    var hasLibrary: Bool { !rootURLs.isEmpty }

    func restore() {
        let urls = BookmarkStore.resolveAll()
        source = BookmarkStore.source()
        guard !urls.isEmpty else { return }
        Task { await open(urls: urls, source: source, persistBookmark: false) }
    }

    func useBundledSample() async {
        guard let url = BookmarkStore.bundledSampleURL() else {
            errorMessage = "Sample Library fixtures are missing from the app bundle."
            return
        }
        stopAllAccess()
        await open(urls: [url], source: .bundledSample, persistBookmark: true)
    }

    /// Call from the document picker callback so iCloud Drive scope stays alive.
    func retainPickedAccess(_ url: URL, replacing: Bool) {
        if replacing {
            stopAllAccess()
            rootURLs = []
        }
        let accessed = url.startAccessingSecurityScopedResource()
        accessingFlags[url.path] = accessed
        if !rootURLs.contains(where: { $0.path == url.path }) {
            rootURLs.append(url)
        }
    }

    func openPickedFolder(_ url: URL, adding: Bool) async {
        if adding {
            var next = rootURLs
            if !next.contains(where: { $0.path == url.path }) {
                next.append(url)
            }
            await open(urls: next, source: .files, persistBookmark: true)
        } else {
            await open(urls: [url], source: .files, persistBookmark: true)
        }
    }

    func removeRoot(_ url: URL) async {
        if accessingFlags[url.path] == true {
            url.stopAccessingSecurityScopedResource()
        }
        accessingFlags[url.path] = nil
        let next = rootURLs.filter { $0.path != url.path }
        if next.isEmpty {
            forgetFolders()
            return
        }
        await open(urls: next, source: source, persistBookmark: source == .files)
    }

    func forgetFolders() {
        stopAllAccess()
        BookmarkStore.clear()
        rootURLs = []
        books = []
        errorMessage = nil
        source = .files
    }

    func forgetFolder() {
        forgetFolders()
    }

    private func stopAllAccess() {
        for url in rootURLs where accessingFlags[url.path] == true {
            url.stopAccessingSecurityScopedResource()
        }
        accessingFlags = [:]
    }

    private func open(
        urls: [URL],
        source: BookmarkStore.Source,
        persistBookmark: Bool
    ) async {
        if source == .files {
            for url in urls {
                if accessingFlags[url.path] != true {
                    accessingFlags[url.path] = url.startAccessingSecurityScopedResource()
                }
            }
        } else {
            stopAllAccess()
        }
        isScanning = true
        errorMessage = nil
        defer { isScanning = false }

        for url in urls {
            try? ICloudFiles.ensureLocal(url)
        }
        let scanned = await LibraryScanner.scan(roots: urls)
        for book in scanned {
            try? ICloudFiles.ensureLocal(book.folderURL)
            for chapter in book.chapters {
                try? ICloudFiles.ensureLocal(chapter.fileURL)
            }
        }
        if scanned.isEmpty {
            errorMessage = """
            No mp3/m4b books found under the chosen folder(s).
            Pick the Library folder (門羅-WhatIf/listen and Immune/listen), or add those two listen folders.
            """
        }

        if persistBookmark {
            do {
                try BookmarkStore.save(urls: urls, source: source)
            } catch {
                errorMessage = "Could not remember this folder: \(error.localizedDescription)"
            }
        }

        rootURLs = urls
        self.source = source
        books = scanned
    }

    func books(in collectionTitle: String) -> [Audiobook] {
        books.filter { $0.collectionTitle == collectionTitle }
    }

    var collectionTitles: [String] {
        var seen: [String] = []
        for book in books where !seen.contains(book.collectionTitle) {
            seen.append(book.collectionTitle)
        }
        return seen
    }
}