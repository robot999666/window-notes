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
  'Railway_Online_Ticketing_System': '高铁订票课程实验',
  'window-notes': '窗边手记 · 静态博客',
};
const curated: Record<string, string> = {
  'Individualized-BCI-Assisted-Control-Platform': '为 ALS 辅助沟通探索个体化脑机控制：校准、模拟输入与安全反馈。',
  'harmony-care-agent': '把家庭看护流程变成可以体验的界面。当前为 Web Mock Demo。',
  'rag_project': '围绕教育资料的检索增强生成练习，连接课程内容与问答。',
  '2-ar-liver-refinenet-foundationpose': '探索肝脏 3D–2D 配准，结合分割、姿态估计与精细化对齐。',
  'verilog-conservative-pipeline-cpu': '用 Verilog 理解五级流水线 CPU 的结构、暂停与冲刷。',
  'data-structure-learning-record': '从顺序表、链表到二叉树，一份持续积累的 C++ 学习记录。',
  'Railway_Online_Ticketing_System': '用 C++ 组织车次、乘客与订单，理解站点区间的余票和状态一致性。',
  'window-notes': 'Astro 静态构建的个人数字花园，包含手记、搜索、RSS 与独立部署。',
};
export const projects = Object.entries(curated).flatMap(([name, description]) => {
  const repo = snapshot.repos.find(repo => repo.name === name && !repo.fork);
  return repo ? [{ ...repo, displayName: names[name], description }] : [];
});
export const notes = (await getCollection('notes')).map(entry => ({ slug: entry.id, ...entry.data })).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
export const categories = ['工程实践', 'AI 与研究', '学习记录'].map(name => ({ name, count: notes.filter(note => note.category === name).length }));
export const tags = [...new Set(notes.flatMap(note => note.tags))];
export const publicRepos = snapshot.repos;
