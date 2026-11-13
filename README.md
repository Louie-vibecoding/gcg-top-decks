# GCG 上位卡组

非官方聚合站：日本店赛 NTC / 编号卡、日本民间 CS（≥50 人）、中国官方锦标赛、欧美（含澳洲/新西兰）公开赛的冠亚军卡组。

- 只展示有卡表或卡组图的场次
- 数据自 2026-08-01 起
- 卡图来自公开源，版权归万代等权利方

GitHub Pages：https://Louie-vibecoding.github.io/gcg-top-decks/

## 每周冠亚上位

`weekly.html` 是原站里的中文每周板块。首页副标题和页脚进入这一页，页内顶栏回到赛事列表。默认日本、最近一个已经过完的周一至周日。历史周用周次选择。2026-11-07 至 11-08 不是单独的周次入口，需要这几天时用起止日期。同一周次可以在「卡组分布」和「占比饼图」之间切换，两套画面用同一份套数。日本发售日历在标题下面，默认收起，展开后仍只表示日本官网发售日。

同一页还可以按含首尾的起止日期统计，或把勾选的周次合并。不相邻的周不会把中间没选的日子算进去。这些数字来自 `data/weekly-records.json` 里已经分好类的单套记录，不把整周快照拼进不完整的几天。同一套如果同时落在所选周和特别窗口里，只计一次。页内的日本官方发售日历只使用日本官网商品记录，发售日不是赛事合法生效日，也不会自动套到中国或欧美。选择一个新卡发售日时，可以截取到下一次新卡发售日前一天，并标明这是发售区间。构建脚本会同时写出周报和这份单套记录；赛事文件更新后的自动构建会一起刷新，不要手改 `data/weekly-records.json`。

分类要颜色和卡号张数一起符合。ZZ 还要有一组支援包。未知体系单独成组并计入分母。名次冲突的套隔离，不改判冠军。代表图优先两台在同一卡表里同场的机体；同一机体的不同形态、驾驶员和基地不拿来凑第二张。

首页和页脚进入 `weekly.html`。代表卡图在 `weekly-cards/`。构建时如果缺图，会按站内已经使用的公开卡图地址补齐。

赛事文件更新推到 `main` 之后，`.github/workflows/weekly-stats.yml` 会自动跑下面的构建和核对，并在周统计或代表图有变化时提交。不要手改 `data/weekly-top.json`，也不要覆盖刚提交的赛事文件，不要把周一中文图重画进这次构建。本地日更后用同一串命令：

```bash
python3 scripts/build_weekly_stats.py
python3 scripts/build_weekly_stats.py --check
python3 scripts/sync_weekly_cards.py --check
python3 scripts/test_weekly_stats.py
python3 scripts/test_custom_range.py
node --test scripts/test_weekly_pie.js scripts/test_weekly_range.js
```

核对时看四件事：店赛文件场次不少于已合并的 main；各组套数之和等于纳入分母；冠军加亚军等于纳入套数；隔离名单里的选手没有被算进分布，同场冠军仍然保留。特别窗口要单独看，不能拿它代替整周。
