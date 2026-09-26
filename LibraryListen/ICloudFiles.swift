import Foundation

enum ICloudFiles {
    /// Starts downloading an iCloud Drive item if it is not on-device yet.
    static func ensureLocal(_ url: URL) throws {
        let values = try url.resourceValues(forKeys: [
            .isUbiquitousItemKey,
            .ubiquitousItemDownloadingStatusKey,
        ])
        guard values.isUbiquitousItem == true else { return }
        if values.ubiquitousItemDownloadingStatus != URLUbiquitousItemDownloadingStatus.current {
            try FileManager.default.startDownloadingUbiquitousItem(at: url)
        }
    }

    static func isCloudOnly(_ url: URL) -> Bool {
        let values = try? url.resourceValues(forKeys: [
            .isUbiquitousItemKey,
            .ubiquitousItemDownloadingStatusKey,
        ])
        guard values?.isUbiquitousItem == true else { return false }
        return values?.ubiquitousItemDownloadingStatus != URLUbiquitousItemDownloadingStatus.current
    }
}