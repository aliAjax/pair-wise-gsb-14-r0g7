<script setup lang="ts">
import { computed, ref } from "vue";
import {
  ACTION_LABELS,
  FUELS,
  ITEM_STATUS_LABELS,
  REGIONS,
  type FlatItem,
  type ReviseTarget
} from "../domain/types";
import { intervalEnd } from "../domain/rules";
import { useDesk } from "../state/desk";
import { fmtMoney, fmtTime } from "../utils/format";

const emit = defineEmits<{ (e: "revise", target: ReviseTarget): void }>();

const desk = useDesk();
const current = desk.currentPrices;
const upcoming = desk.upcoming;
const occupied = desk.occupied;

const region = ref<string>(REGIONS[0]);
const fuel = ref<string>(FUELS[0]);

const versions = computed(() => desk.historyOf(region.value, fuel.value));

/** 生效区间终点：同区同油品下一个生效/已取代版本的生效时刻。 */
const occupiedTimeline = computed(() =>
  versions.value
    .filter((x) => x.item.status === "effective" || x.item.status === "superseded")
    .slice()
    .sort((a, b) => Date.parse(a.item.effectiveAt) - Date.parse(b.item.effectiveAt))
);

function validUntil(id: string): string | null | undefined {
  const index = occupiedTimeline.value.findIndex((x) => x.item.id === id);
  if (index === -1) return undefined;
  return occupiedTimeline.value[index + 1]?.item.effectiveAt ?? null;
}

function revise(x: FlatItem): void {
  emit("revise", {
    itemId: x.item.id,
    region: x.item.region,
    fuel: x.item.fuel,
    oldRetail: x.item.retailPrice,
    batchCode: x.batch.code
  });
}
</script>

<template>
  <section class="board">
    <div class="list-panel">
      <div class="toolbar">
        <h2>当前牌价（生效中）</h2>
        <span class="muted">{{ current.length }} 个区域/油品</span>
      </div>
      <div v-if="current.length === 0" class="empty">暂无生效牌价</div>
      <div v-else class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>区域</th><th>油品</th><th>基准价</th><th>加价幅度</th>
              <th>零售牌价</th><th>生效时刻</th><th>来源批次</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in current" :key="x.item.id">
              <td>{{ x.item.region }}</td>
              <td>{{ x.item.fuel }}</td>
              <td>{{ fmtMoney(x.item.basePrice) }}</td>
              <td>{{ fmtMoney(x.item.markup) }}</td>
              <td><strong>{{ fmtMoney(x.item.retailPrice) }}</strong></td>
              <td>{{ fmtTime(x.item.effectiveAt) }}</td>
              <td>{{ x.batch.code }}</td>
              <td><button type="button" @click="revise(x)">改价</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="list-panel">
      <div class="toolbar">
        <h2>待生效调价（占用区间）</h2>
        <span class="muted">{{ upcoming.length }} 条待生效</span>
      </div>
      <div v-if="upcoming.length === 0" class="empty">暂无待生效调价</div>
      <div v-else class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>区域</th><th>油品</th><th>零售牌价</th><th>生效时刻</th>
              <th>占用区间</th><th>来源批次</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in upcoming" :key="x.item.id">
              <td>{{ x.item.region }}</td>
              <td>{{ x.item.fuel }}</td>
              <td><strong>{{ fmtMoney(x.item.retailPrice) }}</strong></td>
              <td>{{ fmtTime(x.item.effectiveAt) }}</td>
              <td>
                {{ fmtTime(x.item.effectiveAt) }} ~
                {{ intervalEnd(occupied, x.item) ? fmtTime(intervalEnd(occupied, x.item)!) : "最新（未被取代）" }}
              </td>
              <td>{{ x.batch.code }}</td>
              <td>
                <button type="button" class="secondary" @click="desk.withdrawItem(x.item.id)">撤回</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="list-panel">
      <div class="toolbar">
        <h2>版本历史与审批链</h2>
        <div class="history-selects">
          <select v-model="region">
            <option v-for="r in REGIONS" :key="r" :value="r">{{ r }}</option>
          </select>
          <select v-model="fuel">
            <option v-for="f in FUELS" :key="f" :value="f">{{ f }}</option>
          </select>
        </div>
      </div>
      <div v-if="versions.length === 0" class="empty">该区域/油品暂无版本记录</div>
      <div v-else class="record-grid">
        <article v-for="x in versions" :key="x.item.id" class="record">
          <div class="record-head">
            <p class="record-title">
              {{ fmtMoney(x.item.retailPrice) }} 元/升
              <small class="muted">
                基准 {{ fmtMoney(x.item.basePrice) }} + 加价 {{ fmtMoney(x.item.markup) }}
              </small>
            </p>
            <span class="badge" :class="x.item.status">{{ ITEM_STATUS_LABELS[x.item.status] }}</span>
          </div>
          <div class="details">
            <span>生效时刻：{{ fmtTime(x.item.effectiveAt) }}</span>
            <span v-if="validUntil(x.item.id) !== undefined">
              有效期至：{{ validUntil(x.item.id) ? fmtTime(validUntil(x.item.id)!) : "至今" }}
            </span>
            <span>来源批次：{{ x.batch.code }}</span>
            <span v-if="x.item.reason">改价原因：{{ x.item.reason }}</span>
          </div>
          <ul class="timeline">
            <li v-for="rec in x.batch.approvals" :key="rec.id">
              <strong>{{ ACTION_LABELS[rec.action] }}</strong> · {{ rec.actor }} · {{ fmtTime(rec.at) }}
              <br /><span>{{ rec.comment }}</span>
            </li>
          </ul>
        </article>
      </div>
    </div>
  </section>
</template>
