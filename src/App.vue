<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import BatchForm from "./components/BatchForm.vue";
import HistoryLog from "./components/HistoryLog.vue";
import ReviewDesk from "./components/ReviewDesk.vue";
import { currentPrices } from "./domain/rules";
import { initStore, state, tick } from "./storage/store";

const project = {
  title: "油品价格维护 · 基准价联动与批零价差审签台",
  subtitle:
    "每笔调价按区域、油品、基准价、加价幅度与生效时刻登记；同区同油品生效区间不得重叠，价差低于保底毛利或超过当日涨跌幅时整批留草稿；审批后按期生效，生效前撤回释放占用，生效后改价只能新建带原因版本。",
  stack: ["Vue3", "Vite", "TypeScript", "localStorage"],
} as const;

initStore();
let timer = 0;
onMounted(() => {
  timer = window.setInterval(tick, 10_000);
});
onBeforeUnmount(() => window.clearInterval(timer));

const metrics = computed(() => {
  const batches = state.batches;
  return [
    { label: "生效价格（区域·油品）", value: currentPrices(batches, state.now).length },
    { label: "待审批", value: batches.filter((b) => b.status === "pending").length },
    { label: "待生效", value: batches.filter((b) => b.status === "approved").length },
    { label: "草稿待修正", value: batches.filter((b) => b.status === "draft").length },
  ];
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 价格审签闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <section class="workspace">
        <BatchForm />
        <ReviewDesk />
      </section>

      <HistoryLog />
    </div>
  </main>
</template>
