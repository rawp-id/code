<script lang="ts">
  let count = 0;
  const title = "Kode";
</script>

<h1>{title}</h1>
<button on:click={() => count++}>Clicked {count} times</button>
