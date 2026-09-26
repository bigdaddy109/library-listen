import SwiftUI
import UIKit

struct BookCoverView: View {
    let book: Audiobook

    var body: some View {
        if let coverURL = book.coverURL, let image = UIImage(contentsOfFile: coverURL.path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else {
            ZStack(alignment: .leading) {
                palette.bg
                Rectangle()
                    .fill(palette.rule.opacity(0.35))
                    .frame(width: 8)
                VStack(alignment: .leading) {
                    Text("ON DEVICE")
                        .font(.system(size: 10, weight: .semibold, design: .default))
                        .tracking(1.4)
                    Spacer()
                    Rectangle()
                        .fill(palette.rule)
                        .frame(width: 36, height: 3)
                    Text(palette.label)
                        .font(.custom("Georgia", size: 26))
                        .lineLimit(3)
                        .minimumScaleFactor(0.7)
                }
                .foregroundStyle(palette.ink)
                .padding(16)
            }
        }
    }

    private var palette: (bg: Color, ink: Color, rule: Color, label: String) {
        switch book.folderName.lowercased() {
        case "what-if-1":
            return (Color(red: 0.95, green: 0.90, blue: 0.77), Color(red: 0.13, green: 0.10, blue: 0.07), Color(red: 0.76, green: 0.23, blue: 0.13), "WHAT IF?")
        case "how-to":
            return (Color(red: 0.89, green: 0.33, blue: 0.07), Color(red: 0.10, green: 0.07, blue: 0.04), Color(red: 1, green: 0.95, blue: 0.90), "HOW TO")
        case "what-if-2":
            return (Color(red: 0.94, green: 0.78, blue: 0.03), Color(red: 0.08, green: 0.08, blue: 0.08), Color(red: 0.08, green: 0.08, blue: 0.08), "WHAT IF? 2")
        case "immune":
            return (Color(red: 0.75, green: 0.12, blue: 0.16), Color.white, Color.white.opacity(0.85), "IMMUNE")
        default:
            return (Color(red: 0.85, green: 0.80, blue: 0.70), Color(red: 0.12, green: 0.10, blue: 0.08), Color(red: 0.42, green: 0.31, blue: 0.16), book.title.uppercased())
        }
    }
}