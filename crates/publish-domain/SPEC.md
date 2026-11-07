---
id: module-publish-domain
type: module-design
status: active
title: publish-domain
parent: architecture
---

## Responsibility

发布领域唯一的合同来源与不变量守门人：五类 Adapter 的身份、种类与能力声明，Planning Input Snapshot、
Publish Plan、Artifact Manifest、Publish Event、Delivery Receipt、Release Attempt、资源租约、失败分类，
以及规范化摘要与内容寻址等纯计算。上层任何组件「知道」的发布语义，都应能在这里找到出处。

合同带显式版本号。读到不认识的版本时只能显式失败（`PublishError::Unsupported*Version`），不做事后
兼容或尽力解析——旧内容要么仍能按旧版本校验、推广、续传，要么明确拒绝。

## Boundary

无 I/O：不读文件、不起进程、不访问网络、不读时钟与环境。只依赖序列化、摘要与错误库。需要文件系统、
时间或进程的判断属于 adapters、runner-core 或桌面壳。不依赖本仓库任何其他 crate——依赖方向从
这里出发，不允许回指。
