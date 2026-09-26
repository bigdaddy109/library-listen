import Foundation

/// Mac Hub locations. The iPhone never reads these paths directly.
/// Main Hub is already on iCloud Drive; the user picks those folders once.
enum HubPaths {
    static let macLibraryRoot =
        "/Users/jeffwu/Documents/Main Hub/Personal/Daryl Stuff/IIS-義大國際小學/Library"

    static let macMunroeListen =
        "/Users/jeffwu/Documents/Main Hub/Personal/Daryl Stuff/IIS-義大國際小學/Library/門羅-WhatIf/listen"

    static let macImmuneListen =
        "/Users/jeffwu/Documents/Main Hub/Personal/Daryl Stuff/IIS-義大國際小學/Library/Immune/listen"

    static let munroeFolder = "門羅-WhatIf"
    static let immuneFolder = "Immune"
    static let listenFolder = "listen"

    static let knownCollections: [String: CollectionMeta] = [
        munroeFolder: CollectionMeta(id: "munroe", title: "Munroe", author: "Randall Munroe"),
        immuneFolder: CollectionMeta(id: "immune", title: "Immune", author: "Philipp Dettmer"),
    ]

    static let knownBooks: [String: BookMeta] = [
        "what-if-1": BookMeta(
            title: "What If?",
            subtitle: "Serious Scientific Answers to Absurd Hypothetical Questions",
            author: "Randall Munroe"
        ),
        "what-if-2": BookMeta(
            title: "What If? 2",
            subtitle: "Additional Serious Scientific Answers to Absurd Hypothetical Questions",
            author: "Randall Munroe"
        ),
        "how-to": BookMeta(
            title: "How To",
            subtitle: "Absurd Scientific Advice for Common Real-World Problems",
            author: "Randall Munroe"
        ),
        "immune": BookMeta(
            title: "Immune",
            subtitle: "A Journey into the Mysterious System That Keeps You Alive",
            author: "Philipp Dettmer"
        ),
    ]

    static func collectionMeta(forFolder folder: String) -> CollectionMeta {
        if let known = knownCollections[folder] {
            return known
        }
        return CollectionMeta(
            id: slug(folder),
            title: humanize(folder),
            author: "Unknown"
        )
    }

    static func bookMeta(forFolder folder: String, collectionAuthor: String) -> BookMeta {
        let key = folder.lowercased()
        if let known = knownBooks[folder] ?? knownBooks[key] {
            return known
        }
        return BookMeta(title: humanize(folder), subtitle: nil, author: collectionAuthor)
    }

    static func slug(_ value: String) -> String {
        let folded = value.folding(options: [.diacriticInsensitive, .widthInsensitive], locale: .current)
        let scalars = folded.lowercased().map { char -> Character in
            char.isLetter || char.isNumber ? char : "-"
        }
        let collapsed = String(scalars)
            .split(separator: "-", omittingEmptySubsequences: true)
            .joined(separator: "-")
        return collapsed.isEmpty ? "collection" : collapsed
    }

    static func humanize(_ value: String) -> String {
        value
            .replacingOccurrences(of: "[-_]+", with: " ", options: .regularExpression)
            .localizedCapitalized
    }

    static func titleFromFilename(_ fileName: String) -> String {
        let base = (fileName as NSString).deletingPathExtension
        if let regex = try? NSRegularExpression(pattern: #"(?i)(?:^|[-_\s])part\s*0*(\d+)$"#),
           let match = regex.firstMatch(in: base, range: NSRange(base.startIndex..., in: base)),
           let numRange = Range(match.range(at: 1), in: base)
        {
            let number = Int(base[numRange]) ?? 0
            return String(format: "Part %02d", number)
        }
        if let regex = try? NSRegularExpression(pattern: #"^\s*\d+\s*[-.)]+\s*"#),
           let match = regex.firstMatch(in: base, range: NSRange(base.startIndex..., in: base)),
           let range = Range(match.range, in: base)
        {
            let stripped = base[range.upperBound...].trimmingCharacters(in: .whitespaces)
            return stripped.isEmpty ? base : stripped
        }
        return base
    }
}

struct CollectionMeta: Hashable {
    var id: String
    var title: String
    var author: String
}

struct BookMeta: Hashable {
    var title: String
    var subtitle: String?
    var author: String
}