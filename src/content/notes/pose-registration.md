---
title: "给配准实验留一条可以回看的路径"
description: "从固定 seed 到逐帧结果，阅读 Patient1 肝脏 AR 配准实验的复现整理。"
date: "2026-10-13"
category: "AI 与研究"
tags: ["计算机视觉", "配准", "实验复现"]
readingTime: "3 分钟"
source: "https://github.com/robot999666/2-ar-liver-refinenet-foundationpose/blob/main/README.md"
sourceLabel: "2-ar-liver-refinenet-foundationpose"
---

> 整理自公开仓库 README。本篇是 2026 年 10 月 13 日整理的首版项目笔记。

## 复现需要保存什么

这个公开库整理了 Patient1 肝脏 AR 配准实验，保留核心脚本、源数据、模型权重、固定 seed、推理参数和结果表。可重新生成的中间样本与缓存没有全部保存，目录因而围绕复现所需的入口组织。

流程从病例准备、初始姿态、渲染样本与深度处理走向网络训练，再进行推理与结果导出。README 区分了使用已保存权重复现现有表格，以及从源数据重新生成训练样本这两条路径。

## 让评估发生在推理之后

批量脚本处理 Patient1 的多帧数据，源数据缺失的帧会跳过。推理中的选择不使用 TRE / IC 真值，它们在推理结束后用于评估汇总。这个顺序值得保留，否则结果选择与事后评价容易混在一起。

公开表格对应八个有效帧，平均 TRE 为 17.2122 mm，IC 通过为 2 / 8。它们只是这个病例和这组参数下的结果，逐帧差异也仍然可见，不能扩大为通用准确率或临床有效性结论。

## 参数之外还有环境

固定 seed 有助于追踪实验，但 GPU 算子和库版本差异仍可能让重新训练得到不同权重。README 因此建议使用已保存权重复现当前表格。相关 FoundationPose 仓库保留了上游说明，论文与榜单成果应归属其原作者。

来源：[配准复现实验 README](https://github.com/robot999666/2-ar-liver-refinenet-foundationpose/blob/main/README.md)；[相关配准项目](https://github.com/robot999666/1-Foundation-Pose-3D-2D-Registration)。
