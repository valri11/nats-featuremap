import 'ol/ol.css';
import env from './env.json';
import {Map, View} from 'ol';
import TileLayer from 'ol/layer/Tile';
import TileImage from 'ol/source/TileImage';
import VectorTileSource from 'ol/source/VectorTile';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import TileDebug from 'ol/source/TileDebug';
import MVT from 'ol/format/MVT.js';
import WKT from 'ol/format/WKT';
import GeoJSON from 'ol/format/GeoJSON';
import {Fill, Stroke, Style, Text} from 'ol/style';
import {fromLonLat, transformExtent} from 'ol/proj';
import {fromExtent} from 'ol/geom/Polygon';
import {createXYZ} from 'ol/tilegrid';
import {toSize} from 'ol/size';
import Draw from 'ol/interaction/Draw';
import {bbox} from 'ol/loadingstrategy';
import throttle from './throttle';
import { connect, consumerOpts, headers, JSONCodec } from 'nats.ws';

var style = new Style({
	fill: new Fill({
		color: 'rgba(255, 0, 255, 0.1)'
	}),
	stroke: new Stroke({
		color: '#E1F6FF',
		width: 2
	}),
	text: new Text({
		font: '12px Calibri,sans-serif',
		fill: new Fill({
			color: '#000'
		}),
		stroke: new Stroke({
			color: '#fff',
			width: 3
		})
	})
});

const lineStyle = new Style({
	fill: new Fill({
		color: 'rgba(255, 0, 255, 0.1)'
	}),
	stroke: new Stroke({
		color: '#E1F6FF',
		width: 2
	}),
	text: new Text({
		font: '12px Calibri,sans-serif',
		fill: new Fill({
			color: '#000'
		}),
		stroke: new Stroke({
			color: '#fff',
			width: 3
		})
	})
});

const drawStyle = new Style({
	stroke: new Stroke({
		color: '#0000E1',
		width: 4
	}),
});

const tileService = new TileImage({
	url: `${env.kepler.tile}/tiles/v3/Vert/{z}/{x}/{y}.img?apikey=${env.apiKey}&tertiary=satellite`,
});

const drawSource = new VectorSource({wrapX: false});

function getNatsServerUrl() {
    return `ws://${env.natsserver.host}:${env.natsserver.port}`;
}

const jc = new JSONCodec();
var natsServer = await connect({ servers: getNatsServerUrl() })
var myId = Math.random().toString(36).slice(2, 10);

var room = (new URLSearchParams(window.location.search)).get('room');
if (room == null || room == '') {
    room = myId;
    window.location.replace(`?room=${room}`);
}

var topic = 'featuremap.' + room;

function initStreaming() {
    subscribeTopic(topic);
}

async function subscribeTopic(topic) {
    console.log('topic: ' + topic);

    const opts = consumerOpts()
    opts.orderedConsumer()
    const sub = await natsServer.jetstream().subscribe(topic, opts)

    for await(const m of sub) {
        const data = jc.decode(m.data);
        //console.log('data: ' + JSON.stringify(data));

        switch (data.type) {
            case "clear":
                drawSource.clear();
                break;
            case "AddFeature":
                if (data.id != myId) {
                    var parser = new GeoJSON();
                    var feat = parser.readFeature(data.data);
                    //console.log('feat: ' + JSON.stringify(feat));
                    var color = data.color
                    var featStyle = new Style({
                        stroke: new Stroke({
                            color: color,
                            width: 4
                        }),
                    });
                    feat.setStyle(featStyle);
                    drawSource.addFeature(feat);
                }
                break;
            default:
                console.log('unknown msg type: ' + data.type);
                break;
        }
    }
}

const debugLayer = new TileLayer({
    source: new TileDebug({
        projection: 'EPSG:3857',
        tileGrid: createXYZ({
            maxZoom: 21,
        }),
  })
});

debugLayer.getSource().setTileLoadFunction( (tile, text) => {
    const z = tile.getTileCoord()[0];
    const tileSize = toSize(debugLayer.getSource().tileGrid.getTileSize(z));

    const canvas = document.createElement('canvas');
    canvas.width = tileSize[0];
    canvas.height = tileSize[1];

    const context = canvas.getContext('2d');

    context.strokeStyle = 'grey';
    context.strokeRect(0.5, 0.5, tileSize[0] + 0.5, tileSize[1] + 0.5);

    context.fillStyle = 'black';
    context.strokeStyle = 'white';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '18px sans-serif';
    context.lineWidth = 4;
    context.strokeText(text, tileSize[0] / 2, tileSize[1] / 2, tileSize[0]);
    context.fillText(text, tileSize[0] / 2, tileSize[1] / 2, tileSize[0]);

    tile.setImage(context.canvas);
} );

const basemapLayer = new TileLayer({
	source: tileService,
});

//drawSource.on('addfeature', drawSource_OnAddFeature);

function drawSource_OnAddFeature(event) {
    //console.log('addfeature: ' + JSON.stringify(event.feature.getGeometry()));

    var fmt = new GeoJSON();
    var out = fmt.writeFeature(event.feature);
    //console.log('GeoJSON: ' + out);
}

const drawLayer = new VectorLayer({
  source: drawSource,
  style: drawStyle,
});

const mapView = new View({
    center: fromLonLat([150.3120553998699, -33.73196775624329]),
    //center: fromLonLat([149.09757256507874, -35.273810586440796]),
    zoom: 17
});

const map = new Map({
	target: 'map',
	layers: [
        basemapLayer,
        drawLayer,
        debugLayer,
	],
	view: mapView,
});

const drawInteraction = new Draw({
  source: drawSource,
  type: 'Polygon',
});

function addInteraction() {
    var e = document.getElementById("favcolor");
    var col = e.value;
    const drawStyle = new Style({
        stroke: new Stroke({
            color: col,
            width: 4
        }),
    });
    drawLayer.setStyle(drawStyle);
    map.addInteraction(drawInteraction);
}

drawInteraction.on('drawend', function(event) {
    var fmt = new GeoJSON();
    var out = fmt.writeFeature(event.feature);
    var e = document.getElementById("favcolor");
    var col = e.value;
    //console.log(' : ' + out);
    throttle(() => {
        const msg = {
            id: myId,
            type: 'AddFeature',
            data: out,
            color: col,
        };
        natsServer.publish(topic, jc.encode(msg))
    }, 30)()
    //drawSource.clear();
});

map.on('pointermove', showInfo);
map.on('movestart', onMapMoveStart);
map.on('moveend', onMapMoveEnd);

map.on('loadstart', onMapLoadStart);

function onMapLoadStart(event) {
    console.log('map loadstart');

    initStreaming();
}

function onMapMoveStart(event) {
    console.log('movestart');
}

function onMapMoveEnd(event) {
    console.log('moveend');
}

function onClick(id, callback) {
  document.getElementById(id).addEventListener('click', callback);
}

onClick('btn-draw-start', function() {
    addInteraction();
});

onClick('btn-draw-stop', function() {
    map.removeInteraction(drawInteraction);
});

onClick('btn-draw-clear', function() {
    //drawSource.clear();

    const msg = { id: this.id, type: "clear", }
    const h = headers()
    h.set("Nats-Rollup", "sub")
    natsServer.publish(topic, jc.encode(msg), { headers: h })
});

const info = document.getElementById('info');
function showInfo(event) {
  info.innerText = '<???>';
  info.style.opacity = 1;

  const features = map.getFeaturesAtPixel(event.pixel);
  if (features == null || features.length == 0) {
    info.innerText = 'NO DATA';
    info.style.opacity = 1;
    return;
  }
  const properties = features[0].getProperties();
  var pr = properties
  delete pr.geometry;
  info.innerText = JSON.stringify(pr, null, 2);
  info.style.opacity = 1;
}

function getBoundsFromExtent(extent) {
  extent = transformExtent(extent, 'EPSG:3857', 'EPSG:4326')
  var pol = fromExtent(extent)
  var format = new WKT();
  var wkt = format.writeGeometry(pol);
  return wkt.toString();
}

document.getElementById("checkbox-debug-layer").addEventListener('change', function() {
    debugLayer.setVisible(this.checked);
});
document.getElementById("checkbox-basemap").addEventListener('change', function() {
    basemapLayer.setVisible(this.checked);
});

debugLayer.setVisible(document.getElementById("checkbox-debug-layer").checked);
basemapLayer.setVisible(document.getElementById("checkbox-basemap").checked);
