import { getCollection } from 'astro:content';
import snapshot from './github.json';

export const profile = { ...snapshot.profile, avatarUrl: '/avatar.jpg' };
export const syncedAt = snapshot.fetchedAt;
const names: Record<string, string> = {
  'Individualized-BCI-Assisted-Control-Platform': '个体化脑机辅助控制',
  'harmony-care-agent': 'Harmony Care Agent',
  'rag_project': '教育 RAG 练习',
  '2-ar-liver-refinenet-foundationpose': '肝脏 AR 配准探索',
  'verilog-conservative-pipeline-cpu': 'Verilog 流水线 CPU',
  'data-structure-learning-record': '数据结构学习记录',
};
const curated: Record<string, string> = {
  'Individualized-BCI-Assisted-Control-Platform': '为 ALS 辅助沟通探索个体化脑机控制：校准、模拟输入与安全反馈。',
  'harmony-care-agent': '把家庭看护流程变成可以体验的界面。当前为 Web Mock Demo。',
  'rag_project': '围绕教育资料的检索增强生成练习，连接课程内容与问答。',
  '2-ar-liver-refinenet-foundationpose': '探索肝脏 3D–2D 配准，结合分割、姿态估计与精细化对齐。',
  'verilog-conservative-pipeline-cpu': '用 Verilog 理解五级流水线 CPU 的结构、暂停与冲刷。',
  'data-structure-learning-record': '从基础容器到经典算法，一份持续积累的 C++ 学习记录。',
};
export const projects = Object.entries(curated).flatMap(([name, description]) => {
  const repo = snapshot.repos.find(repo => repo.name === name && !repo.fork);
  return repo ? [{ ...repo, displayName: names[name], description }] : [];
});
export const notes = (await getCollection('notes')).map(entry => ({ slug: entry.id, ...entry.data })).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
