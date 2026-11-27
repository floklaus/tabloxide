import { echarts } from './register-all.js'
echarts.init(document.getElementById('c')).setOption({
  xAxis: {},
  yAxis: {},
  series: [
    {
      type: 'line',
      data: [
        [0, 1],
        [1, 2],
      ],
    },
  ],
})
