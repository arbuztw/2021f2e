<script>
import circle from "./assets/circle.svg";
import TDXApi from "./TDXApi";
const api = new TDXApi("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF");
let map;
const searchParams = new URLSearchParams(window.location.search);
let timer = null;

export default {
  created() {},
  mounted() {
    map = L.map("map", { zoomControl: false }).setView(
      [25.033964, 121.564468],
      16
    );
    L.control
      .zoom({
        position: "bottomright",
      })
      .addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(
      map
    );
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(this.$refs.map);
    map.on("zoomend", () => {
      document
        .querySelectorAll("#map .map-marker-icon-wrapper")
        .forEach((ele) => {
          ele.style.fontSize = 1 / Math.pow(1.15, 18 - map.getZoom()) + "em";
        });
    });
    if (this.city != "" && this.route != "") {
      this.displayRoute();
    }
  },
  data() {
    return {
      city: searchParams.get("city") || "",
      route: searchParams.get("route") || "",
      qroute: "",
      stops: [[], []],
      direction: searchParams.get("dir") || 0,
      etaMaps: { 0: {}, 1: {} },
    };
  },
  computed: {
    destinations() {
      return this.stops.map((stopList) =>
        stopList.length == 0 ? "" : stopList[stopList.length - 1].name
      );
    },
    showRouteBanner() {
      return (
        this.stops[0].length > 0 &&
        this.stops[1].length > 0 &&
        this.qroute != ""
      );
    },
    layers() {
      return this.stops.map(createStopMarkersLayer);
    },
    currentLayer() {
      return this.layers[this.direction];
    },
  },
  watch: {
    currentLayer(newLayer, oldLayer) {
      map.removeLayer(oldLayer);
      map.addLayer(newLayer);
      const length = this.stops[this.direction].length;
      const latlng = this.stops[this.direction][Math.floor(length / 2)].latlng;
      map.setView(latlng, 14);
      document
        .querySelectorAll("#map .map-marker-icon-wrapper")
        .forEach((ele) => {
          ele.style.fontSize = 1 / Math.pow(1.2, 18 - map.getZoom()) + "em";
        });
    },
    direction() {
      this.updateUrl();
    },
  },
  methods: {
    panTo(latlng) {
      map.panTo(latlng);
    },
    updateUrl() {
      const url = new URL(window.location);
      let hasValue = false;
      if (this.city) {
        url.searchParams.set("city", this.city);
        hasValue = true;
      }
      if (this.route) {
        url.searchParams.set("route", this.route);
        hasValue = true;
      }
      if (hasValue) {
        url.searchParams.set("dir", this.direction);
        window.history.pushState(null, "", url);
      }
    },
    async displayRoute() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      this.layers.forEach((layer) => map.removeLayer(layer));
      this.updateUrl();
      const stopMaps = await getStopMaps(this.city, this.route);
      this.stops = [toStopList(stopMaps[0]), toStopList(stopMaps[1])];
      this.qroute = this.route;
      this.direction = 0;
      if (
        typeof this.stops[0] !== "undefined" &&
        this.stops[0].length > 0 &&
        typeof this.stops[1] !== "undefined" &&
        this.stops[1].length > 0
      ) {
        this.updateEta();
      }
    },
    async updateEta() {
      this.etaMaps = await getEtaMaps(this.city, this.route);
      timer = setTimeout(this.updateEta, 60000);
    },
    selectDirection(direction) {
      this.direction = direction;
    },
  },
};

const statusToReason = {
  0: "即將進站",
  1: "尚未發車",
  2: "交管不停靠",
  3: "末班車已過",
  4: "今日未營運",
};

async function getStopMaps(city, route) {
  const stopMaps = { 0: {}, 1: {} };
  const data = await api.bus(`/StopOfRoute/City/${city}/${route}`);
  data
    .filter((stopOfRoute) => stopOfRoute["RouteName"]["Zh_tw"] == route)
    .forEach((stopOfRoute) => {
      const stops = stopOfRoute["Stops"];
      const stopMap = stopMaps[stopOfRoute["Direction"]];
      for (const stop of stops) {
        stopMap[stop["StopUID"]] = {
          id: stop["StopUID"],
          name: stop["StopName"]["Zh_tw"],
          sequence: parseInt(stop["StopSequence"]),
          latlng: [
            stop["StopPosition"]["PositionLat"],
            stop["StopPosition"]["PositionLon"],
          ],
        };
      }
    });
  return stopMaps;
}

async function getEtaMaps(city, route) {
  const etaMaps = { 0: {}, 1: {} };
  const data = await api.bus(`/EstimatedTimeOfArrival/City/${city}/${route}`);
  data
    .filter((stop) => stop["RouteName"]["Zh_tw"] == route)
    .forEach((stop) => {
      const stopId = stop["StopUID"];
      const etaMap = etaMaps[stop["Direction"]];
      etaMap[stopId] = getEtaString(stop);
    });
  return etaMaps;
}

function getEtaString(stop) {
  let eta = getEtaFromEstimates(stop["Estimates"]);
  if (eta !== null) {
    return formatTime(eta);
  }
  eta = parseInt(stop["EstimateTime"]);
  if (!isNaN(eta)) {
    return formatTime(eta);
  }
  if (typeof stop["NextBusTime"] !== "undefined") {
    return (
      new Date(stop["NextBusTime"])
        .toTimeString()
        .slice(0, 5)
        .replace(":", "點") + "分 到站"
    );
  }
  return statusToReason[stop["StopStatus"]];
}

function getEtaFromEstimates(estimates) {
  if (estimates) {
    let minEta = Infinity;
    for (const estimate of estimates) {
      const eta = parseInt(estimate["EstimateTime"]);
      if (!isNaN(eta) && eta < minEta) {
        minEta = eta;
      }
    }
    return minEta < Infinity ? minEta : null;
  }
  return null;
}

function toStopList(stopMap) {
  return Object.values(stopMap).sort((stop1, stop2) => {
    return stop1.sequence - stop2.sequence;
  });
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  let display = "";
  if (minutes != 0) {
    display += minutes + "分";
  }
  if (seconds != 0) {
    display += seconds + "秒";
  }
  return display || "0秒";
}

function createStopMarkersLayer(stops) {
  let markers = [];
  for (const stop of stops) {
    markers.push(
      L.marker(stop.latlng, {
        icon: new L.DivIcon({
          className: "map-marker-icon-wrapper",
          html: `<div class="map-marker-icon"><span class="map-marker-icon-text">${stop.sequence}</span></div>`,
        }),
      }).bindTooltip(stop.name)
    );
  }
  return L.layerGroup(markers);
}
</script>

<template>
  <div id="container">
    <div id="header">
      <h1 id="title">陪你等公車</h1>
      <img id="header-bus" src="./assets/bus.svg" />
    </div>
    <div id="main">
      <div id="content">
        <div class="relative">
          <div id="searchbar">
            <select
              name="city"
              class="font-larger bg-yellow searchbar-input"
              style="flex: 0.4"
              v-model="city"
            >
              <option value="Taipei">臺北市</option>
              <option value="NewTaipei">新北市</option>
              <option value="Taoyuan">桃園市</option>
              <option value="Taichung">臺中市</option>
              <option value="Tainan">臺南市</option>
              <option value="Kaohsiung">高雄市</option>
              <option value="Keelung">基隆市</option>
              <option value="Hsinchu">新竹市</option>
              <option value="HsinchuCounty">新竹縣</option>
              <option value="MiaoliCounty">苗栗縣</option>
              <option value="ChanghuaCounty">彰化縣</option>
              <option value="NantouCounty">南投縣</option>
              <option value="YunlinCounty">雲林縣</option>
              <option value="ChiayiCounty">嘉義縣</option>
              <option value="Chiayi">嘉義市</option>
              <option value="PingtungCounty">屏東縣</option>
              <option value="YilanCounty">宜蘭縣</option>
              <option value="HualienCounty">花蓮縣</option>
              <option value="TaitungCounty">臺東縣</option>
              <option value="KinmenCounty">金門縣</option>
              <option value="PenghuCounty">澎湖縣</option>
              <option value="LienchiangCounty">連江縣</option>
            </select>
            <input
              class="font-larger bg-yellow searchbar-input"
              style="flex: 0.8; min-width: 7em"
              type="text"
              name="route"
              placeholder="公車路線"
              v-model="route"
            />
            <button
              class="font-larger bg-orange searchbar-input"
              style="cursor: pointer"
              name="search"
              @click="displayRoute"
            >
              Go!
            </button>
          </div>
          <div id="search-triangle"></div>
        </div>
        <div class="relative">
          <div id="banner-container">
            <div class="banner" v-show="showRouteBanner">
              <div class="font-larger" style="flex: 0.2">{{ qroute }}</div>
              <div style="flex: 0.1">往</div>
              <div id="route-directions">
                <div
                  :class="['destination', direction == 1 ? 'unselected' : '']"
                  @click="selectDirection(0)"
                >
                  {{ destinations[0] }}
                </div>
                <div
                  :class="['destination', direction == 0 ? 'unselected' : '']"
                  @click="selectDirection(1)"
                >
                  {{ destinations[1] }}
                </div>
              </div>
            </div>
          </div>
          <div
            id="banner-triangle"
            :class="showRouteBanner ? 'pink' : 'blue'"
          ></div>
        </div>
        <div id="content-list">
          <div
            class="item"
            v-for="(stop, index) in stops[direction]"
            :key="index"
            @click="panTo(stop.latlng)"
          >
            <div class="serial-no">{{ index + 1 }}</div>
            <div class="name">{{ stop.name }}</div>
            <div class="time" v-show="etaMaps[direction][stop.id]">
              {{ etaMaps[direction][stop.id] }}
            </div>
          </div>
        </div>
      </div>
      <div id="map" ref="map"></div>
    </div>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

input,
select,
button {
  border: none;
  outline: none;
}

.bg-yellow {
  background-color: #f9fbf2;
}

.bg-orange {
  background-color: #fdece0;
}

.bg-pink {
  background-color: #eb9498;
}

.bg-blue {
  background-color: #d6ecf0;
}

.font-larger {
  font-size: 1.1em;
}

.relative {
  position: relative;
}

.inline-block {
  display: inline-block;
}

.flex-1 {
  flex: 1;
}

#app {
  height: 100vh;
  font-size: 1.1em;
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: #0e1c36;
}

#container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 94%;
  margin: auto;
  color: #fff;
}

#header {
  display: flex;
  align-items: end;
  justify-content: space-between;
}

#header-bus {
  height: 8em;
}

#title {
  font-weight: normal;
  margin: 0.55em 0.875em;
}

#main {
  display: flex;
  position: relative;
  flex: 1;
  width: 100%;
  background-color: #fff8f8;
  color: #0e1c36;
  border-top: 1em solid #d6ecf0;
}

#main-header {
  position: absolute;
  top: 0;
  width: 60%;
  padding-left: 2em;
}

#searchbar {
  display: flex;
  position: relative;
  z-index: 5000;
  height: 4em;
  width: calc(100% + 4em);
  padding-left: 2em;
  background-color: #d6ecf0;
  align-items: center;
  justify-content: space-between;
}

.searchbar-input {
  height: 2em;
  margin: 5px;
  text-align: center;
}

#search-triangle {
  position: absolute;
  top: 0;
  left: calc(100% + 4em);
  z-index: 4000;
  height: 4em;
  border-left: 8em solid #d6ecf0;
  border-bottom: 4em solid transparent;
}

#banner-container {
  position: relative;
  z-index: 5000;
  height: 2em;
  background-color: #d6ecf0;
}

.banner {
  display: flex;
  position: relative;
  align-items: center;
  height: 2em;
  line-height: 2em;
  text-align: center;
  justify-content: space-around;
}

#route-directions {
  flex: 0.7;
  display: flex;
  background-color: #eb9498;
}

.destination {
  flex: 1;
  cursor: pointer;
}

.destination.unselected {
  color: rgba(14, 28, 54, 0.5);
}

#banner-triangle {
  position: absolute;
  z-index: 4000;
  top: 0;
  left: 100%;
  border-bottom: 2em solid transparent;
}

#banner-triangle.pink {
  border-left: 4em solid #eb9498;
}

#banner-triangle.blue {
  border-left: 4em solid #d6ecf0;
}

#main-wrapper {
  display: flex;
}

#content {
  position: relative;
  flex: 0.45;
  height: 100%;
  min-width: 0;
}

#content-list {
  position: absolute;
  top: 7.4em;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0 0.7em;
  overflow-y: auto;
}

.item {
  display: flex;
  margin-bottom: 1em;
  cursor: pointer;
}

.serial-no {
  width: 2em;
  height: 2em;
  border-radius: 1em;
  text-align: center;
  line-height: 2em;
  font-size: 0.8em;
  background-color: #afcbff;
}

.name {
  flex: 1;
  padding-left: 1em;
}

.time {
  width: 8em;
  height: 1.5em;
  line-height: 1.5em;

  text-align: center;
  background-color: #eb9498;
}

#map {
  flex: 0.55;
  height: 100%;
  background-color: grey;
}

.map-marker-icon-wrapper {
  border: none !important;
}

.map-marker-icon {
  height: 4em;
  width: 4em;
  text-align: center;
  line-height: 4em;
  border-radius: 4em;
  background-color: #afcbff;
  color: #0e1c36;
  margin-left: -2em;
  margin-top: -2em;
}
.map-marker-icon-text {
  font-size: 2em;
}

@media screen and (max-height: 26em) {
  #header-bus {
    height: 6em;
  }
}

@media screen and (max-width: 720px) {
  #header-bus {
    height: 4em;
  }
  #header > h1 {
    font-size: 1.5em;
  }
  #container {
    width: 100%;
  }
  #searchbar {
    padding-left: 0;
    width: 100%;
  }
  #search-triangle {
    display: none;
  }
  #banner {
    width: calc(100% - 4em);
  }
  #banner-triangle {
    left: calc(100% - 4em);
  }
  #content {
    flex: 1;
  }
  #content-list {
    padding-bottom: calc(min(50vw, 50vh) + 1em);
  }
  #map {
    flex: 0;
    position: absolute !important;
    z-index: 10000;
    width: min(40vw, 40vh);
    height: min(50vw, 50vh);
    right: 1em;
    bottom: 2em;
  }
}
</style>
