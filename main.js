import 'ol/ol.css';
import env from './env.json';
import {Map, View} from 'ol';
import TileLayer from 'ol/layer/Tile';
import TileImage from 'ol/source/TileImage';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import TileDebug from 'ol/source/TileDebug';
import GeoJSON from 'ol/format/GeoJSON';
import {Circle, Fill, Stroke, Style, Text} from 'ol/style';
import {createXYZ} from 'ol/tilegrid';
import {toSize} from 'ol/size';
import {fromLonLat} from 'ol/proj';
import {Draw, Modify, Snap} from 'ol/interaction';
import throttle from './throttle';
import { connect, consumerOpts, headers, JSONCodec } from 'nats.ws';
import { v4 as uuidv4 } from 'uuid';

function getTileServerUrl() {
    const osm = 'http://tile.openstreetmap.org/{z}/{x}/{y}.png';
    if (env.nearmap.apikey == '') {
        return osm;
    }
    return `${env.nearmap.tile}/tiles/v3/Vert/{z}/{x}/{y}.img?apikey=${env.nearmap.apikey}&tertiary=satellite`;
}

const tileService = new TileImage({
	url: getTileServerUrl(),
});

const drawSource = new VectorSource({
    wrapX: false,
    useSpatialIndex: false,
});

function getNatsServerUrl() {
    return `ws://${env.natsserver.host}:${env.natsserver.port}`;
}

const jc = new JSONCodec();
var natsServer = null;
var myId = Math.random().toString(36).slice(2, 10);

var eventCount = 0;
var displayEventCount = 0;
var lastDisplayEvent = 0;

const rangeHistoryCtrl = document.getElementById("range-history")
const rangeHistorySelValCtrl = document.getElementById('range-history-val');
const timeMachineDiv = document.getElementById("time-machine-div")

rangeHistorySelValCtrl.innerText = rangeHistoryCtrl.value;

var room = (new URLSearchParams(window.location.search)).get('room');
if (room == null || room == '') {
    room = myId;
    window.location.replace(`?room=${room}`);
}

var timeMachineSel = (new URLSearchParams(window.location.search)).get('history');
if (timeMachineSel != null) {
    timeMachineDiv.hidden = false;
}

var topic = 'featuremap.' + room;

async function initStreaming() {

    try {
        natsServer = await connect({ servers: getNatsServerUrl() });
    } catch (err) {
        console.log(`error connecting to nats: ${err.message}`);
        return;
    }
    console.info(`connected ${natsServer.getServer()}`);

    subscribeTopic(topic);
}

async function subscribeTopic(topic) {
    console.log('topic: ' + topic);

    const opts = consumerOpts()
    opts.orderedConsumer()
    let sub;
    try {
        sub = await natsServer.jetstream().subscribe(topic, opts);
    } catch (err) {
        console.log(`error subscribing to stream: ${err.message}`);
        return;
    }
    eventCount = 0;
    displayEventCount = 0;
    lastDisplayEvent = 0;

    for await(const m of sub) {
        const data = jc.decode(m.data);
        //console.log('headers: ' + m.headers);
        console.log('data: ' + JSON.stringify(data));

        var defaultColor = featColor.value;
        var parser = new GeoJSON();

        switch (data.type) {
            case "clear":
                drawSource.clear();
                break;
            case "AddFeature":

                var feat = parser.readFeature(data.data);
                var featId = feat.getId();

                eventCount++;
                rangeHistoryCtrl.max = eventCount;
                rangeHistoryCtrl.value = eventCount;
                rangeHistorySelValCtrl.innerText = rangeHistoryCtrl.value;
                displayEventCount = eventCount;

                if (data.id == myId) {
                    break;
                }
                //console.log('add feat: ' + JSON.stringify(feat));
                var col = feat.get("color");
                if (col == null) {
                    col = defaultColor;
                }
                var text = feat.get("text");
                var featStyle = createFeatureStyle(col, text);
                feat.setStyle(featStyle);
                drawSource.addFeature(feat);
                console.log('subscriber - add feat: ' + featId);
                break;
            case "ModifyFeature":
                eventCount++;
                rangeHistoryCtrl.max = eventCount;
                rangeHistoryCtrl.value = eventCount;
                rangeHistorySelValCtrl.innerText = rangeHistoryCtrl.value;
                displayEventCount = eventCount;

                if (data.id == myId) {
                    break;
                }
                var feat = parser.readFeature(data.data);
                var col = feat.get("color");
                if (col == null) {
                    col = defaultColor;
                }
                var text = feat.get("text");
                var featStyle = createFeatureStyle(col, text);
                feat.setStyle(featStyle);
                var featId = feat.getId();
                drawSource.removeFeature(drawSource.getFeatureById(featId));
                drawSource.addFeature(feat);
                break;
            default:
                console.log('unknown msg type: ' + data.type);
                break;
        }
    }
}

function disconnectEventSource() {
    drawSource.clear();

    natsServer.close();
}

async function fetchEvents() {

    disconnectEventSource();

    natsServer = await connect({ servers: getNatsServerUrl() })

    const opts = consumerOpts()
    opts.orderedConsumer()
    const sub = await natsServer.jetstream().subscribe(topic, opts)
    lastDisplayEvent = 0;

    for await(const m of sub) {
        const data = jc.decode(m.data);
        //console.log('data: ' + JSON.stringify(data));

        var defaultColor = featColor.value;
        var parser = new GeoJSON();

        switch (data.type) {
            case "clear":
                drawSource.clear();
                break;
            case "AddFeature":
                if (displayEventCount < lastDisplayEvent + 1) {
                    console.log('skip: ' + featId);
                    break;
                }
                lastDisplayEvent++

                var feat = parser.readFeature(data.data);
                var featId = feat.getId();

                if (data.id == myId) {
                    break;
                }
                //console.log('add feat: ' + JSON.stringify(feat));
                var col = feat.get("color");
                if (col == null) {
                    col = defaultColor;
                }
                var text = feat.get("text");
                var featStyle = createFeatureStyle(col, text);
                feat.setStyle(featStyle);
                drawSource.addFeature(feat);
                console.log('add feat: ' + featId);
                break;
            case "ModifyFeature":
                if (displayEventCount < lastDisplayEvent + 1) {
                    console.log('skip: ' + featId);
                    break;
                }
                lastDisplayEvent++

                if (data.id == myId) {
                    break;
                }
                var feat = parser.readFeature(data.data);
                var col = feat.get("color");
                if (col == null) {
                    col = defaultColor;
                }
                var text = feat.get("text");
                var featStyle = createFeatureStyle(col, text);
                feat.setStyle(featStyle);
                var featId = feat.getId();
                drawSource.removeFeature(drawSource.getFeatureById(featId));
                drawSource.addFeature(feat);
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

const drawLayer = new VectorLayer({
  source: drawSource,
});

const mapView = new View({
    //center: fromLonLat([150.3120553998699, -33.73196775624329]),
    center: fromLonLat([151.2149285868793, -33.8577860563237]),
    zoom: 16
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

const geomTypeSelect = document.getElementById('geomtype');
const featText = document.getElementById('feattext');
const featColor = document.getElementById("featcolor");

var drawInteraction;

const modifyInteraction = new Modify({
  source: drawSource,
});

var snapInteraction = new Snap({
  source: drawSource,
});

function createFeatureStyle(color, textValue) {
    var style = new Style({
        stroke: new Stroke({
            color: color,
            width: 4
        }),
        image: new Circle({
            radius: 12,
            fill: new Fill({
                color: color,
            }),
            stroke: new Stroke({
            color: [255, 255, 255, 1],
            width: 4,
            }),
        }),
        text: new Text({
            textAlign: "left",
            offsetX: 18,
            text: textValue,
            font: 'bold 16px Helvetica,sans-serif',
            fill: new Fill({color: '#0180FD'}),
            stroke: new Stroke({color: [0,0,0,1], width: 5}),
        }),
        zIndex: Infinity,
    });

    return style;
}

function addInteractions() {
    drawInteraction = new Draw({
        source: drawSource,
        type: geomTypeSelect.value,
    });

    drawInteraction.on('drawstart', function(event) {
        var col = featColor.value;
        var text = featText.value;
        var drawStyle = createFeatureStyle(col, text);
        event.feature.setStyle(drawStyle);
    });

    drawInteraction.on('drawend', function(event) {
        var fmt = new GeoJSON();
        var col = featColor.value;
        var text = featText.value;

        event.feature.setId(uuidv4());
        event.feature.set("color", col);
        event.feature.set("text", text);

        var out = fmt.writeFeature(event.feature);
        console.log('publish feat: ' + out);
        throttle(() => {
            const msg = {
                id: myId,
                type: 'AddFeature',
                data: out,
            };
            natsServer.publish(topic, jc.encode(msg));
        }, 30)();
    });

    map.addInteraction(drawInteraction);
    map.addInteraction(modifyInteraction);
    map.addInteraction(snapInteraction);
}

modifyInteraction.on('modifyend', function(event) {
    if (event.features == null || event.features.length == 0) {
        return;
    }
    var fmt = new GeoJSON();

    var modFeat = event.features.item(0);

    var col = featColor.value;
    var text = featText.value;

    modFeat.set("color", col);
    modFeat.set("text", text);

    var featStyle = createFeatureStyle(col, text);
    modFeat.setStyle(featStyle);

    var out = fmt.writeFeature(modFeat);

    console.log('publish feat: ' + out);
    throttle(() => {
        const msg = {
            id: myId,
            type: 'ModifyFeature',
            data: out,
        };
        natsServer.publish(topic, jc.encode(msg));
    }, 30)();
});

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
    addInteractions();
});

onClick('btn-draw-stop', function() {
    map.removeInteraction(drawInteraction);
    map.removeInteraction(modifyInteraction);
    map.removeInteraction(snapInteraction);
});

onClick('btn-draw-clear', function() {
    if (!confirm('This will delete all features. Are you sure?')) {
        return;
    }

    const msg = { id: this.id, type: "clear", }
    const h = headers()
    h.set("Nats-Rollup", "sub")
    natsServer.publish(topic, jc.encode(msg), {headers: h});
});

geomTypeSelect.onchange = function() {
    map.removeInteraction(drawInteraction);
    map.removeInteraction(modifyInteraction);
    map.removeInteraction(snapInteraction);
    addInteractions();
};

onClick('btn-disconnect', function() {
    disconnectEventSource();
});

onClick('btn-connect', fetchEvents);

rangeHistoryCtrl.oninput = function(event) {
    rangeHistorySelValCtrl.innerText = rangeHistoryCtrl.value;
}

rangeHistoryCtrl.onchange = function() {
    rangeHistorySelValCtrl.innerText = rangeHistoryCtrl.value;
    displayEventCount = parseInt(rangeHistoryCtrl.value);
    console.log('displayEventCount: ' + displayEventCount);

    fetchEvents();
};

document.getElementById("checkbox-debug-layer").addEventListener('change', function() {
    debugLayer.setVisible(this.checked);
});
document.getElementById("checkbox-basemap").addEventListener('change', function() {
    basemapLayer.setVisible(this.checked);
});

debugLayer.setVisible(document.getElementById("checkbox-debug-layer").checked);
basemapLayer.setVisible(document.getElementById("checkbox-basemap").checked);
