# Yuzuki Phone Project Instructions

## Mandatory Startup Step

- At the start of every new task or conversation in this repository, before analysis, planning, commands, or file edits, read `C:\Users\Tienchi\Code\手机文件代码结构.txt` completely as UTF-8.
- Treat that file as the authoritative source for the project structure, development rules, storage constraints, cross-app behavior, and tag formats.
- Re-read the file for every new task even if its contents appear familiar from an earlier conversation.
- When using PowerShell, read it with `Get-Content -Raw -Encoding UTF8` so Chinese text is not corrupted.
- If the file is missing or cannot be read, tell the user before making project changes.

## Template Sample Tests

- 已经验证通过的独立模板样例（如论坛、资金管理系统导出 JSON），在无关修改中不要重复测试，也不要为了测试重新创建或恢复已移除的样例文件。
- 不要保留依赖已移除模板样例文件的测试。仅在本次改动涉及相关解析、渲染或导入逻辑时，运行与改动直接相关的核心逻辑测试。

