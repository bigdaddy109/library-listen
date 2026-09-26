# Library Listen 安裝說明（第一次用 Xcode）

這支 App **不用上架 App Store**。用 Xcode 裝到你的 iPhone / iPad（或模擬器）即可。Mac 上目前只有 Command Line Tools 不夠，一定要安裝完整的 **Xcode.app**。

## 0. 先裝 Xcode（只要做一次）

1. 打開 Mac 的 **App Store**。
2. 搜尋 **Xcode**（開發商是 Apple），點 **取得 / 安裝**。檔案很大（約十數 GB），請接電源、等它下載完。
3. 用你的 **Apple ID** 登入 App Store（沒有就先申請一個；這不是幫 Library Listen 上架）。
4. 安裝完成後，到「應用程式」打開 **Xcode**。
5. 第一次開啟會要你同意授權，並安裝 **Additional Components**（額外元件）。按同意、等它做完。
6. 選單 **Xcode → Settings… → Platforms**（或 Components）：確認已有 **iOS** 平台。沒有就在該頁下載 iOS。
7. 插上 iPhone / iPad 時，手機上若跳出「要信任這部電腦嗎？」選 **信任**。

只裝 Command Line Tools、沒有 Xcode.app 的話，無法點 Run 把 App 裝到手機。

## 1. 拿到專案

任選一種：

**A. 用 zip（現在就能裝）**

1. 下載 `LibraryListen.zip`（在這次 agent 對話的附件 / artifacts）。
2. 雙擊解壓縮，得到專案資料夾。
3. 用終端機進入該資料夾（把路徑改成你的）：

```bash
cd ~/Downloads/LibraryListen
./start.sh
```

**B. 若你已在 agent 頁面按過 Create repo**

```bash
git clone <建立 repo 之後頁面上出現的 Origin 網址>
cd <資料夾名稱>
./start.sh
```

`./start.sh` 會產生靜音測試音檔，並在 Mac 上打開 `LibraryListen.xcodeproj`。

## 2. 在 Xcode 裡選裝置

1. 視窗最上方中間，確認 scheme 是 **LibraryListen**。
2. 右邊的裝置選單：
   - 真機：選你的 **iPhone** 或 **iPad**（用線接上，或已設過無線除錯）。
   - 還沒接手機：可先選一個 **iPhone 模擬器** 試「內建 sample」。
3. 第一次用真機：手機解鎖、保持亮著。

## 3. 設定 Signing Team（真機必須）

1. 左側點最上方的藍色 **LibraryListen** 專案。
2. 選 TARGETS 裡的 **LibraryListen**。
3. 打開 **Signing & Capabilities**。
4. 勾選 **Automatically manage signing**。
5. **Team** 選你的 Apple ID（沒有 Team 就點 Add Account，登入同一個 Apple ID）。
6. 若 Bundle Identifier 顯示衝突，在後面加一點個人縮寫即可，例如 `com.jeffwu.librarylisten`。
7. 手機可能跳出「不受信任的開發者」：到 iPhone **設定 → 一般 → VPN 與裝置管理**（或「裝置管理」）→ 點你的 Apple ID → **信任**。

模擬器通常不用改 Team。

## 4. 執行（Run）

1. 按左上角 ▶，或快捷鍵 **⌘R**。
2. 第一次編譯會稍久，等狀態列結束。
3. App 名稱是 **Library Listen**。

**不要** 用 Product → Archive 去上架 App Store。v1 只需要 Xcode Run。

## 5. 第一次開啟 App：選 iCloud 的 Library 資料夾

真機通勤聽書（Main Hub 已在 iCloud Drive）：

1. 若音檔還有雲朵圖示：先到 **檔案 App → iCloud Drive**，進入  
   `Main Hub / Personal / Daryl Stuff / Library`  
   對資料夾或書按一下 **下載**（Download Now），等它進手機。
2. 回到 **Library Listen**，點 **選擇 Hub 資料夾**（或 Choose a Hub folder）。
3. 在 Files 選取上面的 **Library** 資料夾（不要選錯層）。
4. App 會記住這個資料夾，並掃描：
   - `Library/門羅-WhatIf/listen/`
   - `Library/Immune/listen/`（`Immune-Part01.mp3` … `Part09.mp3`）

模擬器沒有你的 iCloud 書：點 **使用內建 sample** 即可試播放（靜音短檔）。

之後可到右上角 **Folders** 再加 `門羅-WhatIf` 或 `Immune`。進度存在手機本機，通勤不需要 Mac 開機。

## 出問題時

| 情況 | 做法 |
| --- | --- |
| 沒有 Xcode.app，只有 `xcode-select` / CLT | 回步驟 0，從 App Store 安裝 Xcode |
| Team 是 None、真機不能 Run | 步驟 3 登入 Apple ID |
| 找不到書 | 確認選的是 **Library**，且 `listen/` 裡已下載到本機 |
| 雲朵、不能播 | 檔案 App 對該檔 **下載** |
| 要重選資料夾 | App 內 Folders → Replace / Add |

沒有 TTS，也不需要為這支 App 申請 App Store 上架。