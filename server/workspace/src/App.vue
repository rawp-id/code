<template>
  <div class="app">
    <h1>{{ title }}</h1>
    <button @click="count++">Clicked {{ count }} times</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const title = "Kode";
const count = ref(0);
</script>

<style scoped>
.app { font-family: system-ui, sans-serif; }
</style>
