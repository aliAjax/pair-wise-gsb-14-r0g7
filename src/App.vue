<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import BatchComposer from "./components/BatchComposer.vue";
import BatchQueue from "./components/BatchQueue.vue";
import PriceBoard from "./components/PriceBoard.vue";
import { RULES } from "./domain/rules";
import type { ReviseTarget } from "./domain/types";
import { useDesk } from "./state/desk";

const desk = useDesk();

const tab = ref<"desk" | "board">("desk");
const reviseTarget = ref<ReviseTarget | null>(null);

const metrics = computed(() => [
  { label: "生效牌价", value: desk.currentPrices.value.length },
  { label: "待生效调价", value: desk.upcoming.value.length },
  { label: "待审批批次", value: desk.batches.value.filter((b) => b.status === "pending").length },
  { label: "草稿批次", value: desk.batches.value.filter((b) => b.status === "draft").length }
]);

function onRevise(target: ReviseTarget): void {
  reviseTarget.value = target;
  tab.value = "desk";
}

function onSubmitted(): void {
  reviseTarget.value = null;
}

let timer: number | undefined;
onMounted(() => {
  desk.promoteDue();
  timer = window.setInterval(() => desk.promoteDue(), 30_000);
});
onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">石油行业 · 价格审签闭环</p>
          <h1>油品价格维护 · 基准价联动与批零价差审签台</h1>
          <p class="subtitle">
            每笔调价按区域、油品、基准价、加价幅度与生效时刻登记；同区同油品生效区间不得重叠，
            触发保底毛利或当日涨跌幅规则的批次整批留草稿；审批后按期生效，生效前可撤回释放占用，
            生效后改价只能新建带原因版本，旧值与审批链全程留痕。
          </p>
        </div>
        <div class="side">
          <div class="stack">
            <span class="tag">Vue3</span>
            <span class="tag">Vite</span>
            <span class="tag">TypeScript</span>
            <span class="tag">localStorage</span>
          </div>
          <label class="operator">
            当前操作员
            <input v-model="desk.state.operator" placeholder="值班经理" />
          </label>
        </div>
      </header>

      <section class="metrics">
        <article v-for="m in metrics" :key="m.label" class="metric">
          <span>{{ m.label }}</span>
          <strong>{{ m.value }}</strong>
        </article>
      </section>

      <nav class="tabs">
        <button type="button" :class="{ active: tab === 'desk' }" @click="tab = 'desk'">审签台</button>
        <button type="button" :class="{ active: tab === 'board' }" @click="tab = 'board'">牌价与版本</button>
      </nav>

      <p class="rules-note">
        审签规则：同区同油品生效区间不得重叠 · 加价幅度不低于保底毛利 {{ RULES.minMargin.toFixed(2) }} 元/升 ·
        当日涨跌幅不超过 ±{{ RULES.dailyLimitPct }}%
      </p>

      <section v-show="tab === 'desk'" class="workspace">
        <BatchComposer
          :revise-target="reviseTarget"
          @submitted="onSubmitted"
          @cancel-revise="reviseTarget = null"
        />
        <BatchQueue />
      </section>

      <PriceBoard v-show="tab === 'board'" @revise="onRevise" />
    </div>
  </main>
</template>
