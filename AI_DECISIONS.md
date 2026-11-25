# AI 决策记录

本文件记录自主推进过程中遇到的待定项目、调研依据与取舍。按时间顺序追加，每条决策一个二级标题。

---

## 2026-11-25 桌宠测试环境与 QtMultimedia 缺失

**待定问题**：`desktop/` 的 82 个单元测试在本机报 22 个导入错误，全部卡在 `PySide6.QtMultimedia` 导入失败。是代码缺陷还是环境问题？若为环境问题，应在哪个环境修、怎么修才不波及已验证的其他链路？

**背景约束**：

- 本机有两个相关 Python 环境：conda `agent`（`C:\Users\Administrator\.conda\envs\agent`，Python 3.10）与 `C:\ProgramData\anaconda3` 下的其他环境。
- `agent` 环境同时承载 GSV 语音训练链路（`torch 2.11.0+cu130`、`torchaudio`、`pytorch-lightning`、`torchcodec`），已在该链路验证可用。
- `desktop/requirements.txt` 固定 `PySide6==6.11.2`；`docs/BUILD.md` 规定用独立 `.venv` 构建。
- 仓库 `.gitignore` 只忽略 `.venv/`，在仓库内新建 `.venv-test/` 会被 git 追踪。

**调研参考**：

- 读取 `PySide6==6.11.2` 元包 METADATA：`Requires-Dist: shiboken6==6.11.2`、`PySide6_Essentials==6.11.2`、`PySide6_Addons==6.11.2`。即 `PySide6` 只是元包，真正提供 `QtMultimedia` 的是 `PySide6_Addons`。
- 实测 `agent` 环境：`PySide6 6.11.0`、`shiboken6 6.11.0`，其 `PySide6` 包目录内 `os.listdir` 无任何 `Multimedia*` 文件，即被裁剪过且版本落后一档。
- 该做法契合 `docs/BUILD.md`「使用独立虚拟环境」的既有约定。

**候选方案**

1. **新建 conda 命名环境**：`conda create -n aemeath-pet python=3.12`，再按 `requirements.txt` 精确安装。命名环境位于 `C:\Users\Administrator\.conda\envs\aemeath-pet`，在仓库之外，不污染工作树；与现有 `agent` 环境同源便于管理。代价：另需一份 Qt6 二进制（约数百 MB）。
2. **在 `agent` 环境内升级到 6.11.2**：省一份依赖。代价是 `shiboken6` 是 PySide6 的二进制绑定层，升级会连带替换整个 Qt6 二进制栈，可能破坏已在该环境验证过的语音训练链路。
3. **在仓库内建 `.venv-test`**：符合 `docs/BUILD.md` 字面做法。代价是需同时改 `.gitignore`，扩大本次改动面，且 venv 与 conda 管理两套并存。

**选择**：方案一（conda 命名环境 `aemeath-pet`）。

**选择理由**：用户明确指定「用 conda 建立虚拟环境」。该方案在仓库之外、不动 `agent` 的训练链路、无需修改 `.gitignore`，把改动面限制在环境层，生产代码零改动。

**未选原因**：

- 方案 2：`shiboken6` 升级会替换 Qt6 二进制栈，`agent` 环境里的语音训练链路存在被破坏的风险；为修一个测试问题而去动已验证链路，风险收益不成比例。
- 方案 3：需连带修改 `.gitignore`，扩大改动范围；且与用户指定的 conda 方式相左。

**验证方式**：

- `python -c "from PySide6.QtMultimedia import QMediaPlayer"` 通过。
- `os.listdir(PySide6 包目录)` 中出现 `QtMultimedia.pyd`、`QtMultimediaWidgets.pyd`、`Qt6Multimedia.dll` 等 7 个文件。
- 全量 `python -m unittest discover -s tests` 由「82 用例 / 1 失败 / 22 错误」变为「360 用例 / 2 失败 / 0 错误」。

**风险与回滚**：新增的 conda 环境与其他环境隔离，出问题用 `conda env remove -n aemeath-pet` 即可完全回退，不影响任何生产代码或既有环境。

---

## 2026-11-25 测试对 8.3 短路径的假设

**待定问题**：`test_one_click_update` 报 `ValueError: 更新日志目录不匹配`。是 `update_recovery.recover()` 的实现缺陷，还是测试的假设问题？

**背景约束**：`update_recovery.recover()` 第 144 行执行 `root=pathlib.Path(root).resolve()`，第 146 行与 `journal['root']` 做字符串比对。生产代码中 `resolve()` 是必要且正确的行为（真实安装目录需要规范化后再比对）。

**调研参考**：未找到可直接借鉴的成熟先例；按代码内证据判断。

**实测证据**：

```
raw      : C:\Users\ADMINI~1\AppData\Local\Temp\tmp8lkgpz0b
resolved : C:\Users\Administrator\AppData\Local\Temp\tmp8lkgpz0b
same?    : False
```

即 `tempfile.mkdtemp()` / `TemporaryDirectory()` 在某些 Windows 配置下返回 8.3 短名 `ADMINI~1`，而 `resolve()` 展开为长名 `Administrator`，两者字符串必然不相等。该用例在 `setUp` 中用 `tempfile.TemporaryDirectory()` 建立 root 后，再把 `str(self.root)` 原样写入 journal，因此必然不匹配。

**候选方案**

1. **在测试 `setUp` 中建立 root 时调用 `.resolve()`**：让测试持有一个规范化路径，与 `recover()` 的比对基准一致。代价仅 3 行改动，只在测试文件内。
2. **在 `recover()` 中对 journal 一侧也做 `resolve()` 后再比较**：代价是生产代码要接受任意等价路径写法。但这会让「目录不匹配」这一真实安全校验（防止跨目录误回滚）弱化，而生产路径通常已是长名。
3. **不做处理，标注为已知环境限制**：代价是该用例在短名环境下永久失败，掩盖潜在的回归信号。

**选择**：方案一。

**选择理由**：问题根因在测试的路径假设，而非生产逻辑。生产代码的 `resolve()` 是保护性的安全校验，不应为迁就测试而放宽。改动面最小（3 行、单文件），且能恢复该 22 个用例的回归信号。

**未选原因**：

- 方案 2：会削弱 `recover()` 的目录一致性校验。该校验用于防止更新日志被错误目录认领后误回滚，是真实的安全约束，不应让步。
- 方案 3：让一个本可修复的用例长期失败，会稀释后续回归中的失败信号。

**验证方式**：`python -m unittest discover -s tests -k test_one_click_update` 由「22 用例中 1 个 error」变为「22 用例全部 OK」；随后全量重跑确认无回归（`errors` 由 1 降为 0，`failures` 保持 2，仅剩两项经判定的环境限制项）。

**风险与回滚**：仅改测试文件，不影响运行时行为。回滚方式为 `git checkout desktop/tests/test_one_click_update.py`。

---

## 2026-11-25 两项环境限制项暂不改生产代码

**待定问题**：全量跑完后仍有 2 个失败，是否一并修复？

**背景约束**：两项失败均已实测定性为环境限制，而非仓库缺陷。

**实测证据**：

1. `test_a_version_that_a_process_still_runs_from_is_kept_whole`：`psapi.EnumProcesses` 正常返回 435 个进程，但对 `ping.exe` 子进程调用 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` 后 `QueryFullProcessImageNameW` 无法取到其镜像路径，`running_versions()` 返回空集。即在当前会话下进程镜像枚举不完整。
2. `test_a_line_ends_only_after_it_has_been_played`：该用例自带 `if QMediaDevices.defaultAudioOutput().isNull(): self.skipTest('no audio output')` 保护。在 `QT_QPA_PLATFORM=offscreen` 下，Qt 报告了一个非空但实际不可用的音频输出设备，因而绕过了该保护并失败。属本次运行使用 offscreen 平台造成的假阳性。

**候选方案**

1. **不修改生产代码**，将两项记为已知环境限制。
2. 修改 `running_versions()` 或音频播放路径以迁就环境观测结果。
3. 为两项增加无条件 `skipTest`。

**选择**：方案一。

**选择理由**：改生产代码去迁就环境观测偏差，会掩盖真实问题（例如进程枚举失败在生产中意味着清理逻辑可能误删正在运行的版本，这必须保持为可见的失败信号）。

**未选原因**：

- 方案 2：会弱化 `program_cleanup` 的「正在运行的版本不得删除」这一核心安全约束，以及音频播放的结束判定逻辑。
- 方案 3：无条件跳过会让回归测试永久失去这两条覆盖。

**验证方式**：以 `360 用例 / 2 失败 / 0 错误` 作为当前基线，在真实桌面与声卡会话下重跑可进一步甄别。本轮未执行该项验证，**结论仅覆盖至「已定性为环境限制」，未证明在标准桌面环境下必然通过**。

**风险与回滚**：未改代码，无需回滚。风险在于后续开发者若在短名或受限进程枚举环境运行，会看到同样两项失败，需查阅本条记录。

---

## 2026-11-25 与 aemeath 角色扮演 Skill 的融合方向（未实施）

**待定问题**：用户希望把当前在用的 `aemeath` 角色扮演 Skill（`C:\Users\Administrator\.dsh\skills\aemeath`）融合进 `dsh-aemeath` 插件与桌宠。以何种形式融合、素材如何分级、配音如何获得？

**背景约束**：

- 桌宠的台词池机制已现成：`bindings.py` 的 `bubble_text`、`voice_pool.py` 的 `pick_clip`、`settings.json` 已启用的 `bubble_mode: "audio"` 与 `audio_subtitles`。
- 桌宠只能播放音频文件，不能实时合成语音。
- Skill 自带 `UPDATE-20261028.md` 规定：「旧 interaction 中的『被夸』『糊弄』模板若无逐条来源，只作为演绎示例，不当作官方 verbatim」。
- `docs/SECURITY.md` 承诺只向桌宠写入「状态、匿名会话编号、时间、余额」，新增字段需同步修订该契约。

**调研参考**：

- Skill 结构：`SKILL.md`（扮演规则）、`interaction.md`（约 52 条 verbatim+演绎模板）、`conflicts.md`（OOC 风险）、`UPDATE-20261028.md`（来源复核）。
- 桌宠现有 90 条 OGG 语音位于 `desktop/defaults/audio/爱弥斯语音/`，已按 `整理`（思考）、`等待你回应`、`任务完成`、`任务出错`、`待机陪伴` 等动作编号配对。
- `C:\qwen-tts` 现状：爱弥斯原始素材 116 个 wav → 108 条 24 kHz 切片；`aemeath_processed/train_with_codes.jsonl` 已完成 tokenizer 编码；基础模型 `Qwen3-TTS-12Hz-0.6B-Base` 与 `Qwen3-TTS-Tokenizer-12Hz` 已在 `models/` 本地就位；训练脚本 `Qwen3-TTS/finetuning/sft_12hz.py` 与 `prepare_data.py` 齐备。
- `C:\qwen-tts\ckpt` 中已有爱弥斯的 **GSV 架构**产物（`aimisi-e16.ckpt`、`aimisi_e10_s180.pth`），由 `distill_gen.py` 以 `gsv_tts.TTS` 加载；该产物不属于 Qwen3-TTS 架构，不能直接用于 Qwen3-TTS 推理。
- 本机 GPU：RTX 4060 Laptop，`torch 2.11.0+cu130`，`torch.cuda.is_available()=True`；`agent` 环境内 `qwen_tts` 包**未安装**，且未发现任何已完成的 aimisi Qwen3-TTS 输出目录。

**候选方案**

1. **仅生成导出的台词对照表（轻量）**：按 Skill 场景生成可导入配置，运行时零改动。代价：无配音，仅气泡文字；导出后与 Skill 更新脱钩。
2. **绑定层混装 + 字幕前缀标记**：插件在快照中增加匿名语义枚举（`phase`/`reason`），桌宠把 Skill 台词以 `bubble_text` 并入候选；`verbatim` 与 `artifact` 通过字幕前缀可见区分。代价：改 `lib/index.js`、桌宠触发点与 `docs/SECURITY.md`。
3. **Skill 台词经 Qwen3-TTS（aimisi 音色）合成音频后喂入现有台词池**：桌宠音频管线无需改动（`resolve_audio` 已支持 OGG、`audio_clips` 已现成），只需新增语料生成与入池环节。代价：需先在本地完成 Qwen3-TTS 微调并验证音色可复现。

**选择**：方向定为方案 2 与方案 3 的组合（**尚未实施**）。用户已确认的两条约束：

- 两桶都要，且**在字幕上加前缀标记做可见区分**。
- 配音走 **Qwen TTS 推理**；若无可用产物则考虑本机训练。经核实已有预处理数据与基础模型，倾向于短训而非从零训练。

**选择理由**：方案 2 的写入面最小且路径已有测试覆盖；方案 3 解决了「Skill 台词无配音」这一由桌宠架构决定的根本限制，且不改动现有音频管线。

**未选原因**：

- 方案 1：用户明确要求「重量：改代码接入台词包」，且导出内容会与 Skill 更新脱钩。

**验证方式**：尚未实施，无验证证据。计划中的验证路径为：先在 `aemeath-pet` 环境中安装 `qwen_tts`，用 108 条已编码数据短训若干轮，生成一句试听音频与原版对照，音色可复现后再进入接入实现。

**风险与回滚**：尚未实施。已知风险：(a) TTS 合成音色可能无法可靠复现爱弥斯；(b) `CREDITS.txt` 目前将语音记为「原版语音」，合成音的性质与分发边界需另行明确，不应默认随 npm 包发布；(c) 若把 `artifact` 演绎句当作官方原话播放，将违反 Skill 自身的来源复核规则，因此前缀标记不可省略。

**待办**：上述 (a)(b) 两项在实施前必须由用户确认。
