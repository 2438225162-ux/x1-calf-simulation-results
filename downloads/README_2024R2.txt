# X1：在 ANSYS 2024 R2 重建前处理

这是一套可转移的前处理重建包，不是把 2026 R1 数据库改名后交给旧版打开。需要在接收电脑上的 **Mechanical 2024 R2** 中执行，由它生成自己的原生文件。

## 在另一台电脑上怎么用

1. 将完整 ZIP 复制过去，先解压到可写的短英文路径，例如 `D:\X1_2024R2_Preprocess`。不要在 ZIP 内直接运行，也不要只复制 `.py`。
2. 确认这台电脑安装并能正常启动 **Mechanical 2024 R2**，且许可证可用；只安装 SpaceClaim 不够。
3. 双击 `Build_2024R2.cmd`。它优先找 `AWP_ROOT242`，也会检查 C/D 盘的标准安装路径；找不到时输入包含 `aisol` 的 `v242` 安装目录。
4. 等待 `generated_年月日_时分秒` 文件夹生成。过程只导入 CAD、创建前处理并保存，不划分网格、不求解。
5. 查看根目录 `latest_build.json`：应有 `complete: true`、`target_242_runtime: true`，并列出四份输出。失败则查看 `BUILD_FAILED.txt` 和输出目录的 `build_verification.json`，不要把部分文件当成功交付。
6. 启动独立的 **Mechanical 2024 R2**，通过“文件 → 打开”打开生成的 `.mechdb`。先看 `S01_8000_preprocess.mechdb` 和 `C01_8000_preprocess.mechdb`；4000 N 文件是各自对照。

输出文件如下，每份同时生成不带结果的 `.mechpz` 归档：

| 文件 | 内容 |
|---|---|
| `S01_8000_preprocess.mechdb` | 足底合力 8000 N，9 实体，6 Bonded，2 个固定姿态关节 |
| `S01_4000_preprocess.mechdb` | 相同 S01 前处理，足底合力 4000 N |
| `C01_8000_preprocess.mechdb` | 两铜套各 4000 N，7 实体，6 接触，8 根试验螺栓梁 |
| `C01_4000_preprocess.mechdb` | 相同 C01 前处理，两铜套各 2000 N |

`.mechdb` 是 Mechanical 原生模型，不是可由 Workbench“打开工程”直接读取的 `.wbpj`。需要 Workbench 项目容器时，可在 Workbench 2024 R2 中导入目标版本生成的 Mechanical 文件，再另存 Workbench 工程；不要直接打开本机原来保存的 2026 R1 `.wbpj/.wbpz`。

## 保留的内容

- 原 `导出3.STEP` 的中性几何，文件内容不变；它不是 `X1腿部总装0906.STEP` 总装模型。
- 36 个源实体及对应抑制状态：S01 启用 9 个、C01 启用 7 个。
- 原材料 XML、实际材料分配、固定支承、向 CAD −Y 的面合力。
- S01 的 6 个有效 Bonded 接触、PITCH/ROLL 固定位姿关节及可变形连接。
- C01 的 5 个 Bonded 和 1 个 Frictionless 配合接触；8 根 D3 mm 圆截面钢梁，E210 GPa、ν0.30，无预紧，局部两端 Rigid。
- S01 的 5 个局部网格控制；C01 的 30 个实际网格控制，包括保留在最终树中的局部 Hard Sizing。
- 实际分析设置。S01 界面为 Program Controlled、初始1/最小1/最大10；源求解器最终输入的有效子步限制为1/1/1。这两个层面的记录有区别。C01 为自动子步 On、初始1/最小1/最大100。
- 8000 N / 4000 N 分开保存，C01 两档分别保留 In-Core / Out-of-Core 内存策略。

## 网格和结果

**本包重建可编辑 CAD 前处理及网格控制，不携带现成网格，也不携带任何求解结果。** 新模型的 Mesh 尚未生成、Solution 显示需要求解，这是预期状态。查看材料、接触、关节、梁、载荷、约束和网格控制无需求解。

如需要直接查看原来的百万节点网格，使用另附的 `X1_FE_mesh_preprocess` CDB 备用包。CDB 从有限元网格合成几何，与本包可编辑 CAD 几何/网格控制树的用途不同；其导入限制见该包说明。

## 验证及版本边界

- 本机只有 2026 R1 Mechanical，2024 R2 只有 SpaceClaim。已用独立 2026 R1 Mechanical 会话执行同一套重建逻辑，四份模型均保存并重新打开，实体/接触/关节/梁/网格控制数和载荷核对通过，未生成网格、未求解，归档未含结果。
- 已逐项核对 2024 R2 官方 API stubs，所用几何/材料导入、接触、关节、梁、保存及归档接口在该版存在。这不代替 2024 R2 实际运行验证；目标版最终状态以接收电脑的 `build_verification.json` 为准。
- 导入后按实体表面面积与质心、面类型/面积/质心重新匹配作用域，不假设旧几何 ID 在新版本保持不变。S01 核对254个关键面，C01 核对151个关键面；缺面或歧义会停止，不能静默选最近面继续。
- 程序控制项在不同版本的有效求解器默认值可能有差异。本包保留已回读的前处理设置；没有执行跨版本求解或结果等价性验证。
- 原试算假设继续适用：足底中心加载是确认的假设；C01 螺栓截面/材料是试验输入，铜套与螺栓强度数据尚不完整，两工况均未验证网格收敛。

## 失败时提供哪些文件

将 `BUILD_FAILED.txt`、`latest_build.json` 和最新 `generated_...` 目录中的 `progress.json`、`build_verification.json`、`*_geometry_mapping.json` 一起保留。文件只记录本次重建状态，不包含许可证凭据。

不要在已有且未保存的 Mechanical 模型中直接执行重建函数；脚本会拒绝清空有模型的会话。不要手工修改 `.mechdb/.wbpz` 的版本标签。

官方兼容性依据：[2024 R2 版本兼容说明](https://ansyshelp.ansys.com/public/views/secured/corp/v242/en/global_releasenotes/ReleaseNotesCompatibility.html)。
