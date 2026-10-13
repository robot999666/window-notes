---
title: "沿着五级流水线，看一条指令走完"
description: "在 ModelSim 波形里，观察取指、译码、执行、访存、写回与暂停、冲刷。"
date: "2026-10-13"
category: "学习记录"
tags: ["Verilog", "CPU", "ModelSim"]
readingTime: "3 分钟"
source: "https://github.com/robot999666/verilog-conservative-pipeline-cpu/blob/main/README.md"
sourceLabel: "verilog-conservative-pipeline-cpu"
---

## 给指令的旅程分段

这份 Verilog CPU 项目采用简化的 MIPS 风格五级流水线，用于 ModelSim 仿真。取指、译码、执行、访存与写回分别承接一段工作，顶层数据通路连接控制单元、寄存器文件、ALU 与存储器。

先沿着一条指令查看 PC、指令内容、ALU 结果与写回数据，再把相邻指令放进同一个时间轴，是理解这份代码的一种阅读方式。测试台暴露关键状态信号，仿真脚本负责编译、启动测试与添加波形。

## 暂停也是流水线的一部分

这个设计使用保守暂停处理数据相关，没有采用转发。条件分支在 MEM 阶段确定，跳转与 jr 则在 ID 阶段重定向；暂停和冲刷用于处理相关与控制转移。

观察这些信号时，可以把“哪一级正在做什么”与“下一拍允许谁前进”放在一起理解。项目的指令范围包含算术、逻辑、移位、访存与控制转移，存储器还涉及字、字节和半字访问。

## 用预期状态核对理解

仓库保存当前测试程序的指令镜像和最终寄存器状态。对照预期结果与关键波形，能帮助定位理解中的偏差。当前公开说明针对仿真，不提供 FPGA 实测或生产 CPU 性能结论；保守设计也应结合其学习目标阅读。

来源：[公开源码与 README](https://github.com/robot999666/verilog-conservative-pipeline-cpu/blob/main/README.md)。
