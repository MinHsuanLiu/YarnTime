# YarnTime PWA v5 — Journal

這是一個可安裝到 iPhone 主畫面的網頁 App（PWA）。

## 已完成
- 多個毛線作品分開計時
- 一次只讓一件作品計時
- 開始 / 暫停
- 分段紀錄
- 每件作品累積工時
- 工時統計
- 本機資料保存
- JSON 備份 / 匯入
- iPhone 加到主畫面後可全螢幕使用
- 切到背景或鎖螢幕後，回來仍會依開始時間正確計算

## iPhone PWA 的限制
iOS 網頁 App 不能像原生 App 一樣真正長時間在背景執行，也不能使用 Dynamic Island 做即時控制。
YarnTime 使用「開始時間戳」計算，因此即使背景暫停執行 JavaScript，回到 App 後工時仍會正確。

## 怎麼放上網
最簡單是把整個資料夾部署到任何支援 HTTPS 的靜態網站服務，例如 GitHub Pages、Cloudflare Pages、Netlify、Vercel。

PWA 的 service worker 通常需要 HTTPS（localhost 例外）。

## iPhone 安裝
1. Safari 開啟部署後的網址。
2. 點 Safari 分享按鈕。
3. 選「加入主畫面」。
4. 名稱保留 YarnTime，按「加入」。
5. 回到主畫面，會看到 YarnTime 圖示。

## 本機測試
如果電腦有 Python：
```bash
python -m http.server 8000
```
然後在瀏覽器開啟 http://localhost:8000

同一 Wi‑Fi 下，也可以用電腦的區網 IP 讓 iPhone 暫時開啟測試，但完整 PWA 安裝與 service worker 建議使用 HTTPS。


## v2 更新
- 分段紀錄同時顯示「本段時間」與「累積時間」。
- 按下分段的瞬間即固定時間，輸入分段名稱的時間不會被算進上一段。
- 舊版分段資料可直接相容，不需刪除原有作品。
- 更新 service worker 快取策略，部署新版後較不容易卡在舊檔。


## v3 修正
- 修正 iPhone 點擊「新增分段」等輸入框時，Safari / PWA 自動把整個畫面放大的問題。
- 保留使用者手動縮放能力，不使用 `user-scalable=no`。
- 原理：iOS 對小於 16px 的輸入文字會自動放大；v3 將 input / textarea / select 固定為 16px。


## v4 新增
- 每件作品可新增 1 張封面照片。
- iPhone 可從相簿挑照片或直接拍照。
- 首頁作品卡片會顯示封面縮圖。
- 作品詳細頁可新增、更換、移除照片。
- 照片會壓縮後存在 IndexedDB，不佔用原本 localStorage 的小容量。
- 匯出備份會連照片一起備份；也相容舊版沒有照片的備份。
- 作品詳細頁新增「目前這一段」即時計時。
- 右上角奇怪的圓形 ＋ 改為「＋ 新增」膠囊按鈕。
- 保留 v2 本段/累積分段邏輯與 v3 iPhone 輸入框不自動放大修正。

## GitHub 這次需要更新
為避免版本混用，建議直接更新：
- index.html
- app.js
- styles.css
- sw.js

icon 與 manifest 不需要更換。


## v5 — 手作工時＋作品成長日誌
- 每次「分段」都會成為一個製作進度節點。
- 每個節點可記：名稱、一句製作紀錄、1 張進度照片、本段時間、累積工時。
- 作品詳細頁改成「製作時間軸」。
- 可將作品標記為「已完成」，完成時會自動停止計時，並保留總工時與製作期間。
- 首頁顯示每件作品的紀錄次數與完成狀態。
- 統計頁新增：總手作工時、製作中作品、已完成作品、完成作品平均工時、進度節點數、工時排行。
- 匯出備份會包含封面照與所有進度照片。
- 相容既有作品、工時、分段與 v4 封面照片。

## GitHub 這次更新 4 個檔案
- index.html
- app.js
- styles.css
- sw.js
