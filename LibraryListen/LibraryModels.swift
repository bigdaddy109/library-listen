import Foundation

struct ListenRoot: Identifiable, Hashable {
    let id: String
    let title: String
    let folder: String
    let url: URL
}

enum BookKind: String, Hashable {
    case chapters
    case audiobook
}

struct Chapter: Identifiable, Hashable {
    let id: String
    let title: String
    let index: Int
    let fileURL: URL
    let start: TimeInterval
    let end: TimeInterval?
    let duration: TimeInterval?

    var fileName: String { fileURL.lastPathComponent }
}

struct Audiobook: Identifiable, Hashable {
    let id: String
    let collectionId: String
    let collectionTitle: String
    let folderName: String
    let title: String
    let subtitle: String?
    let author: String
    let kind: BookKind
    let folderURL: URL
    let coverURL: URL?
    let chapters: [Chapter]
    let audioFormat: String

    var chapterCount: Int { chapters.count }
}

struct ProgressRecord: Codable, Hashable {
    var chapterId: String
    var positionSeconds: Double
    var updatedAt: Date
    /// Chapter length in seconds. Missing on progress files written before this field existed.
    var chapterDurationSeconds: Double?
}