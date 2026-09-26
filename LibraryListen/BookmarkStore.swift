import Foundation

enum BookmarkStore {
    private static let legacyKey = "libraryFolderBookmark"
    private static let rootsKey = "libraryFolderBookmarks"
    private static let sourceKey = "libraryFolderSource"

    enum Source: String {
        case files
        case bundledSample
    }

    static func save(urls: [URL], source: Source) throws {
        let blobs = try urls.map { url in
            try url.bookmarkData(
                options: .minimalBookmark,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
        }
        UserDefaults.standard.set(blobs, forKey: rootsKey)
        UserDefaults.standard.set(source.rawValue, forKey: sourceKey)
        UserDefaults.standard.removeObject(forKey: legacyKey)
    }

    static func save(url: URL, source: Source) throws {
        try save(urls: [url], source: source)
    }

    static func clear() {
        UserDefaults.standard.removeObject(forKey: legacyKey)
        UserDefaults.standard.removeObject(forKey: rootsKey)
        UserDefaults.standard.removeObject(forKey: sourceKey)
    }

    static func source() -> Source {
        Source(rawValue: UserDefaults.standard.string(forKey: sourceKey) ?? "") ?? .files
    }

    static func resolveAll() -> [URL] {
        if source() == .bundledSample {
            return [bundledSampleURL()].compactMap { $0 }
        }
        if let blobs = UserDefaults.standard.array(forKey: rootsKey) as? [Data] {
            return blobs.compactMap { resolveBookmark($0) }
        }
        if let data = UserDefaults.standard.data(forKey: legacyKey),
           let url = resolveBookmark(data)
        {
            return [url]
        }
        return []
    }

    static func resolve() -> URL? {
        resolveAll().first
    }

    private static func resolveBookmark(_ data: Data) -> URL? {
        var stale = false
        guard let url = try? URL(
            resolvingBookmarkData: data,
            options: [],
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        ) else {
            return nil
        }
        return url
    }

    static func bundledSampleURL() -> URL? {
        if let url = Bundle.main.url(forResource: "Fixtures", withExtension: nil) {
            return url
        }
        return Bundle.main.resourceURL?.appendingPathComponent("Fixtures", isDirectory: true)
    }
}