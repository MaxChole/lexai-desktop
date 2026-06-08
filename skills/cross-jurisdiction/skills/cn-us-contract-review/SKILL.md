---
name: cn-us-contract-review
description: >
  并行对照中国法与美国法审查同一份合同，输出双栏风险分析。
argument-hint: '[合同文本 | 合同文件路径 | 关键条款粘贴]'
user-invocable: true
jurisdiction: CROSS
cn-skill-ref: cn:commercial-legal:review
us-skill-ref: us:commercial-legal:review
---
# /cn-us-contract-review

## Instructions

1. 对同一份合同分别执行中国法与美国法分析，不要把两边标准混写。
2. 输出时保留各自的风险重点、缺失事实和待验证引用。
3. 如适用法律、争议解决、责任限制、数据处理或知识产权条款存在跨法域差异，应明确点出。
4. 最终结果必须适合做双栏对照，而不是单一融合结论。
