import Foundation
import Observation

@MainActor
@Observable
final class ProgressStore {
    static let shared = ProgressStore()

    private var records: [String: ProgressRecord] = [:]
    private let url: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private init() {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = folder.appendingPathComponent("LibraryListen", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        url = dir.appendingPathComponent("progress.json")
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
        load()
    }

    func progress(for bookId: String) -> ProgressRecord? {
        records[bookId]
    }

    func save(
        bookId: String,
        chapterId: String,
        positionSeconds: Double,
        chapterDurationSeconds: Double? = nil
    ) {
        let previous = records[bookId]
        let duration: Double?
        if let chapterDurationSeconds, chapterDurationSeconds > 0, chapterDurationSeconds.isFinite {
            duration = chapterDurationSeconds
        } else if previous?.chapterId == chapterId {
            duration = previous?.chapterDurationSeconds
        } else {
            duration = nil
        }
        var next = records
        next[bookId] = ProgressRecord(
            chapterId: chapterId,
            positionSeconds: max(0, (positionSeconds * 100).rounded() / 100),
            updatedAt: Date(),
            chapterDurationSeconds: duration
        )
        records = next
        persist()
    }

    private func load() {
        guard let data = try? Data(contentsOf: url),
              let decoded = try? decoder.decode([String: ProgressRecord].self, from: data)
        else { return }
        records = decoded
    }

    private func persist() {
        guard let data = try? encoder.encode(records) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
