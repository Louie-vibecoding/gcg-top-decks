# GCG 上位卡组

非官方聚合站：日本店赛 NTC / 编号卡、日本民间 CS（≥50 人）、中国官方锦标赛、欧美（含澳洲/新西兰）公开赛的冠亚军卡组。

- 只展示有卡表或卡组图的场次
- 数据自 2026-08-01 起
- 卡图来自公开源，版权归万代等权利方

GitHub Pages：https://Louie-vibecoding.github.io/gcg-top-decks/

## 每周冠亚上位

`weekly.html` 是中文每周统计。默认日本、最近一个已经过完的周一至周日。历史周和 2026-11-07 至 11-08 特别窗口可以切换。特别窗口不是整周总数。

分类看卡号和张数，未知体系单独成组并计入分母。名次有争议的 5 套默认隔离，不改判冠军，也不把原始 72 套写成决赛冠亚。代表图优先两台在同一卡表里同场的机体；驾驶员和通用外挂不拿来凑第二张。

每日数据刷新之后，在同一工作流里跑下面的命令即可。重复执行不会把样本加两次，也不会新建外部账号：

```bash
python3 scripts/build_weekly_stats.py
python3 scripts/build_weekly_stats.py --check
python3 scripts/test_weekly_stats.py
```
