import SwiftUI

enum ShelfSort: String, CaseIterable, Identifiable {
    case collection = "Collection"
    case title = "Title"
    case author = "Author"
    case recent = "Recent"

    var id: String { rawValue }
}

struct ShelfView: View {
    @Environment(LibrarySession.self) private var session
    @Environment(PlayerController.self) private var player
    @Environment(ProgressStore.self) private var progressStore
    @AppStorage("librarylisten.shelfSort") private var sortRaw = ShelfSort.collection.rawValue
    @State private var query = ""

    private var sort: ShelfSort {
        ShelfSort(rawValue: sortRaw) ?? .collection
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                if session.isScanning {
                    ProgressView("Scanning Library…")
                        .tint(ListenTheme.amber)
                }
                if let error = session.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                if !trimmedQuery.isEmpty && filteredBooks.isEmpty {
                    Text("No books match “\(trimmedQuery)”.")
                        .font(.body)
                        .foregroundStyle(ListenTheme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if sort == .collection {
                    ForEach(collectionSections, id: \.title) { section in
                        collectionSection(section.title, books: section.books)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(sortedBooks) { book in
                            bookCard(book)
                        }
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 28)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .top, spacing: 0) {
            searchAndSort
        }
        .navigationTitle("Shelf")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink("Folders") {
                    SettingsView()
                }
            }
        }
    }

    private var searchAndSort: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(ListenTheme.muted)
                TextField("Search title, author, or chapter", text: $query)
                    .textFieldStyle(.plain)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(ListenTheme.ink)
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(ListenTheme.muted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(ListenTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ShelfSort.allCases) { item in
                        let selected = sort == item
                        Button(item.rawValue) {
                            sortRaw = item.rawValue
                        }
                        .buttonStyle(.plain)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(selected ? ListenTheme.amber : ListenTheme.card, in: Capsule())
                        .foregroundStyle(selected ? Color.black : ListenTheme.ink)
                    }
                }
            }

            Text(countLabel)
                .font(.caption)
                .foregroundStyle(ListenTheme.muted)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(ListenTheme.background)
    }

    private var countLabel: String {
        let count = filteredBooks.count
        if trimmedQuery.isEmpty {
            return "\(count) books"
        }
        return "\(count) matches"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("On-device Library")
                .font(.system(size: 32, weight: .regular, design: .serif))
            Text(sourceLine)
                .font(.footnote)
                .foregroundStyle(ListenTheme.muted)
        }
    }

    private var sourceLine: String {
        if session.source == .bundledSample {
            return "Bundled silent fixtures — add the real iCloud Drive Hub folders for commute listening."
        }
        if session.rootURLs.count > 1 {
            return "\(session.rootURLs.count) folders · \(session.books.count) books"
        }
        if let path = session.rootURL?.path {
            return path
        }
        return "iCloud Drive Library"
    }

    private var filteredBooks: [Audiobook] {
        let q = trimmedQuery
        guard !q.isEmpty else { return session.books }
        return session.books.filter { bookMatches($0, query: q) }
    }

    private var sortedBooks: [Audiobook] {
        switch sort {
        case .collection, .title:
            return filteredBooks.sorted(by: titleOrder)
        case .author:
            return filteredBooks.sorted { lhs, rhs in
                let author = lhs.author.localizedStandardCompare(rhs.author)
                if author != .orderedSame { return author == .orderedAscending }
                return titleOrder(lhs, rhs)
            }
        case .recent:
            return filteredBooks.sorted { lhs, rhs in
                let left = progressStore.progress(for: lhs.id)
                let right = progressStore.progress(for: rhs.id)
                switch (left, right) {
                case let (lhsProgress?, rhsProgress?):
                    if lhsProgress.updatedAt != rhsProgress.updatedAt {
                        return lhsProgress.updatedAt > rhsProgress.updatedAt
                    }
                    return titleOrder(lhs, rhs)
                case (_?, nil):
                    return true
                case (nil, _?):
                    return false
                case (nil, nil):
                    return titleOrder(lhs, rhs)
                }
            }
        }
    }

    private var collectionSections: [(title: String, books: [Audiobook])] {
        let visible = filteredBooks
        var order: [String] = []
        for book in session.books where visible.contains(where: { $0.id == book.id }) {
            if !order.contains(book.collectionTitle) {
                order.append(book.collectionTitle)
            }
        }
        return order.map { title in
            let books = visible
                .filter { $0.collectionTitle == title }
                .sorted(by: titleOrder)
            return (title, books)
        }
    }

    private func titleOrder(_ lhs: Audiobook, _ rhs: Audiobook) -> Bool {
        let title = lhs.title.localizedStandardCompare(rhs.title)
        if title != .orderedSame { return title == .orderedAscending }
        return lhs.id < rhs.id
    }

    private func bookMatches(_ book: Audiobook, query: String) -> Bool {
        let fields = [book.title, book.author, book.collectionTitle, book.subtitle ?? "", book.folderName]
        if fields.contains(where: { $0.localizedStandardContains(query) }) {
            return true
        }
        return book.chapters.contains { $0.title.localizedStandardContains(query) }
    }

    private func matchingChapterTitles(_ book: Audiobook) -> [String] {
        let q = trimmedQuery
        guard !q.isEmpty else { return [] }
        return book.chapters
            .filter { $0.title.localizedStandardContains(q) }
            .map(\.title)
    }

    private func collectionSection(_ title: String, books: [Audiobook]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.title3.weight(.semibold))
            ForEach(books) { book in
                bookCard(book)
            }
        }
    }

    private func bookCard(_ book: Audiobook) -> some View {
        let progress = progressStore.progress(for: book.id)
        let hits = matchingChapterTitles(book)
        return VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: book) {
                HStack(alignment: .top, spacing: 14) {
                    BookCoverView(book: book)
                        .frame(width: 92, height: 122)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(book.title)
                            .font(.headline)
                            .foregroundStyle(ListenTheme.ink)
                        Text(book.author)
                            .font(.subheadline)
                            .foregroundStyle(ListenTheme.muted)
                        Text("\(book.chapterCount) chapter\(book.chapterCount == 1 ? "" : "s") · \(book.audioFormat.uppercased())")
                            .font(.caption)
                            .foregroundStyle(ListenTheme.muted)
                        if let progress {
                            let status = shelfProgressStatus(book: book, progress: progress, player: player)
                            Text(status.line)
                                .font(.caption)
                                .foregroundStyle(ListenTheme.amber)
                            if let fraction = status.fraction {
                                ListenProgressBar(fraction: fraction)
                            }
                        } else {
                            Text("Not started")
                                .font(.caption)
                                .foregroundStyle(ListenTheme.muted)
                        }
                        if !hits.isEmpty {
                            Text(chapterHitLine(hits))
                                .font(.caption)
                                .foregroundStyle(ListenTheme.amber)
                                .lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
            HStack {
                if progress != nil {
                    Button("Continue") {
                        player.playOrResume(book)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(ListenTheme.amber)
                    .foregroundStyle(.black)
                    .frame(minHeight: 44)
                }
                NavigationLink("Chapters", value: book)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
            }
        }
        .padding(14)
        .background(ListenTheme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func chapterHitLine(_ titles: [String]) -> String {
        let shown = titles.prefix(2).joined(separator: " · ")
        let extra = titles.count - 2
        if extra > 0 {
            return "\(shown) · +\(extra)"
        }
        return shown
    }
}
