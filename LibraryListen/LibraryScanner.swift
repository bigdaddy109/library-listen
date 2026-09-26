import AVFoundation
import Foundation

enum LibraryScanner {
    static let audioExtensions: Set<String> = ["mp3", "m4b", "m4a", "aac"]
    static let coverExtensions: Set<String> = ["jpg", "jpeg", "png", "webp"]
    private static let skipFolderNames: Set<String> = ["ebooks", "_source"]

    static func discoverListenRoots(at root: URL) -> [ListenRoot] {
        var found: [ListenRoot] = []
        var seen = Set<String>()
        walkForListen(root, depth: 0, maxDepth: 2, found: &found, seen: &seen)
        return found.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }

    static func scan(root: URL) async -> [Audiobook] {
        await scan(roots: [root])
    }

    static func scan(roots: [URL]) async -> [Audiobook] {
        var books: [Audiobook] = []
        var ids = Set<String>()
        for root in roots {
            for listenRoot in discoverListenRoots(at: root) {
                for book in await loadBooks(in: listenRoot) {
                    if ids.insert(book.id).inserted {
                        books.append(book)
                    }
                }
            }
        }
        return books
    }

    private static func walkForListen(
        _ url: URL,
        depth: Int,
        maxDepth: Int,
        found: inout [ListenRoot],
        seen: inout Set<String>
    ) {
        let fm = FileManager.default
        var isDir: ObjCBool = false
        guard fm.fileExists(atPath: url.path, isDirectory: &isDir), isDir.boolValue else { return }

        if url.lastPathComponent.lowercased() == HubPaths.listenFolder {
            addListenRoot(url, collectionFolder: url.deletingLastPathComponent().lastPathComponent, found: &found, seen: &seen)
            return
        }

        let directListen = url.appendingPathComponent(HubPaths.listenFolder, isDirectory: true)
        if fm.fileExists(atPath: directListen.path, isDirectory: &isDir), isDir.boolValue {
            addListenRoot(directListen, collectionFolder: url.lastPathComponent, found: &found, seen: &seen)
        }

        guard depth < maxDepth else { return }
        let children = (try? fm.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        for child in children {
            let name = child.lastPathComponent
            guard name.lowercased() != HubPaths.listenFolder else { continue }
            guard !name.hasPrefix("_") else { continue }
            guard !skipFolderNames.contains(name.lowercased()) else { continue }
            guard (try? child.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            walkForListen(child, depth: depth + 1, maxDepth: maxDepth, found: &found, seen: &seen)
        }
    }

    private static func addListenRoot(
        _ listenURL: URL,
        collectionFolder: String,
        found: inout [ListenRoot],
        seen: inout Set<String>
    ) {
        let path = listenURL.standardizedFileURL.path
        guard seen.insert(path).inserted else { return }
        let meta = HubPaths.collectionMeta(forFolder: collectionFolder)
        found.append(
            ListenRoot(id: meta.id, title: meta.title, folder: collectionFolder, url: listenURL)
        )
    }

    private static func loadBooks(in listenRoot: ListenRoot) async -> [Audiobook] {
        var books: [Audiobook] = []
        if !audioFiles(in: listenRoot.url).isEmpty {
            if let book = await loadBook(
                folderURL: listenRoot.url,
                listenRoot: listenRoot,
                bookFolderName: listenRoot.folder
            ) {
                books.append(book)
            }
        }
        for folder in bookDirectories(in: listenRoot.url) {
            if let book = await loadBook(
                folderURL: folder,
                listenRoot: listenRoot,
                bookFolderName: folder.lastPathComponent
            ) {
                books.append(book)
            }
        }
        return books
    }

    private static func audioFiles(in directory: URL) -> [URL] {
        let files = ((try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )) ?? [])
        return files
            .filter { audioExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    private static func bookDirectories(in listenURL: URL) -> [URL] {
        let children = ((try? FileManager.default.contentsOfDirectory(
            at: listenURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? [])
        return children
            .filter { url in
                (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
                    && !url.lastPathComponent.hasPrefix("_")
            }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    }

    private static func loadBook(
        folderURL: URL,
        listenRoot: ListenRoot,
        bookFolderName: String
    ) async -> Audiobook? {
        let files = ((try? FileManager.default.contentsOfDirectory(
            at: folderURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )) ?? [])
        let audio = files
            .filter { audioExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
        guard !audio.isEmpty else { return nil }

        let cover = files
            .filter { coverExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { lhs, rhs in
                func score(_ url: URL) -> Int {
                    let name = url.lastPathComponent.lowercased()
                    return name.contains("cover") || name.contains("folder") ? 0 : 1
                }
                return score(lhs) < score(rhs)
            }
            .first

        let kind: BookKind
        let chapters: [Chapter]
        if audio.count == 1, ["m4b", "m4a"].contains(audio[0].pathExtension.lowercased()) {
            kind = .audiobook
            chapters = await loadAudiobookChapters(fileURL: audio[0])
        } else {
            kind = .chapters
            chapters = audio.enumerated().map { index, url in
                Chapter(
                    id: url.lastPathComponent,
                    title: HubPaths.titleFromFilename(url.lastPathComponent),
                    index: index + 1,
                    fileURL: url,
                    start: 0,
                    end: nil,
                    duration: nil
                )
            }
        }

        let collection = HubPaths.collectionMeta(forFolder: listenRoot.folder)
        let meta = HubPaths.bookMeta(forFolder: bookFolderName, collectionAuthor: collection.author)
        return Audiobook(
            id: "\(listenRoot.id)/\(bookFolderName)",
            collectionId: listenRoot.id,
            collectionTitle: listenRoot.title,
            folderName: bookFolderName,
            title: meta.title,
            subtitle: meta.subtitle,
            author: meta.author,
            kind: kind,
            folderURL: folderURL,
            coverURL: cover,
            chapters: chapters,
            audioFormat: audio[0].pathExtension.lowercased()
        )
    }

    private static func loadAudiobookChapters(fileURL: URL) async -> [Chapter] {
        let asset = AVURLAsset(url: fileURL)
        let durationSeconds = (try? await asset.load(.duration)).map { CMTimeGetSeconds($0) }
        let locales = (try? await asset.load(.availableChapterLocales)) ?? []
        let locale = locales.first ?? Locale.current
        let groups = (try? await asset.loadChapterMetadataGroups(
            withTitleLocale: locale,
            containingItemsWithCommonKeys: [.commonKeyTitle]
        )) ?? []

        if !groups.isEmpty {
            return groups.enumerated().map { index, group in
                let titleItem = group.items.first { $0.commonKey == .commonKeyTitle }
                let title = titleItem?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
                let start = CMTimeGetSeconds(group.timeRange.start)
                let end = CMTimeGetSeconds(group.timeRange.end)
                return Chapter(
                    id: "\(fileURL.lastPathComponent)#\(index)",
                    title: (title?.isEmpty == false ? title! : "Chapter \(index + 1)"),
                    index: index + 1,
                    fileURL: fileURL,
                    start: start.isFinite ? start : 0,
                    end: end.isFinite ? end : nil,
                    duration: end.isFinite && start.isFinite ? max(0, end - start) : durationSeconds
                )
            }
        }

        return [
            Chapter(
                id: fileURL.lastPathComponent,
                title: HubPaths.titleFromFilename(fileURL.lastPathComponent),
                index: 1,
                fileURL: fileURL,
                start: 0,
                end: nil,
                duration: durationSeconds
            ),
        ]
    }
}