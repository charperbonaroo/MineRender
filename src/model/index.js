import * as THREE from "three";
import * as $ from 'jquery';
import mergeDeep from "../lib/merge";
import Render, { loadTextureAsBase64, scaleUv, defaultOptions, DEFAULT_ROOT, loadModelFromPath, loadBlockState } from "../renderBase";
import ModelConverter from "./modelConverter";

String.prototype.replaceAll = function (search, replacement) {
    let target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

const colors = [
    0xFF0000,
    0x00FFFF,
    0x0000FF,
    0x000080,
    0xFF00FF,
    0x800080,
    0x808000,
    0x00FF00,
    0x008000,
    0xFFFF00,
    0x800000,
    0x008080,
];

const FACE_ORDER = ["east", "west", "up", "down", "south", "north"];
const TINTS = ["lightgreen"];

const textureCache = {};

let defOptions = {
    camera: {
        type: "perspective",
        x: 35,
        y: 25,
        z: 20,
        target: [0, 0, 0]
    },
    type: "block",
    centerCubes: false,
    assetRoot: DEFAULT_ROOT
};

class ModelRender extends Render {

    constructor(options, element) {
        super(options, defOptions, element);

        this.renderType = "ModelRender";

        this.models = [];
        this.attached = false;
    }

    render(models, cb) {
        let modelRender = this;

        if (!modelRender.attached) {// Don't init scene if attached, since we already have an available scene
            super.initScene(function () {
                modelRender.element.dispatchEvent(new CustomEvent("modelRender", {detail: {models: modelRender.models}}));
            });
        } else {
            console.log("[ModelRender] is attached - skipping scene init");
        }

        let type = this.options.type;
        let promises = [];
        for (let i = 0; i < models.length; i++) {
            promises.push(new Promise((resolve) => {
                let model = models[i];

                let offset;
                let rotation;

                let doModelLoad = function (model, type) {
                    console.log("Loading model " + model + " of type " + type + "...");
                    loadModel(model, type, modelRender.options.assetRoot)
                        .then(modelData => mergeParents(modelData, modelRender.options.assetRoot))
                        .then((mergedModel) => {
                            if (!PRODUCTION) {
                                console.log("Merged Model: ");
                                console.log(mergedModel);
                            }

                            if (!mergedModel.textures) {
                                console.warn("The model doesn't have any textures!");
                                console.warn("Please make sure you're using the proper file.")
                                console.warn("(e.g. 'grass.json' is invalid - 'grass_normal.json' would be the correct file.");
                                return;
                            }

                            loadTextures(mergedModel.textures, modelRender.options.assetRoot).then((textures) => {
                                renderModel(modelRender, mergedModel, textures, type, model, offset, rotation).then((renderedModel) => {
                                    modelRender.models.push(renderedModel);
                                    modelRender._scene.add(renderedModel);

                                    resolve();
                                })
                            });
                        });
                };

                if (typeof model === "string") {
                    let parsed = parseModelType(model);
                    model = parsed.model;
                    type = parsed.type;

                    doModelLoad(model, type);
                } else if (typeof model === "object") {
                    if (model.hasOwnProperty("offset")) {
                        offset = model["offset"];
                    }
                    if (model.hasOwnProperty("rotation")) {
                        rotation = model["rotation"];
                    }

                    if (model.hasOwnProperty("model")) {
                        if (model.hasOwnProperty("type")) {
                            type = model["type"];
                        } else {
                            let parsed = parseModelType(model["model"]);
                            model = parsed.model;
                            type = parsed.type;
                        }

                        doModelLoad(model, type);
                    } else if (model.hasOwnProperty("blockstate")) {
                        type = "block";

                        loadBlockState(model.blockstate, modelRender.options.assetRoot).then((blockstate) => {
                            if (blockstate.hasOwnProperty("variants")) {

                                if (model.hasOwnProperty("variant")) {
                                    if (!blockstate.variants.hasOwnProperty(model.variant)) {
                                        console.warn("Missing variant for " + model.blockstate + ": " + model.variant);
                                        return;
                                    }
                                    let variant = blockstate.variants[model.variant];

                                    rotation = [0, 0, 0];
                                    if (variant.hasOwnProperty("x")) {
                                        rotation[0] = variant.x;
                                    }
                                    if (variant.hasOwnProperty("y")) {
                                        rotation[1] = variant.y;
                                    }
                                    if (variant.hasOwnProperty("z")) {// Not actually used by MC, but why not?
                                        rotation[2] = variant.z;
                                    }

                                    doModelLoad(variant.model, "block");
                                } else {
                                    let variant;
                                    if (blockstate.variants.hasOwnProperty("normal")) {
                                        variant = blockstate.variants.normal;
                                    } else {
                                        variant = blockstate.variants[Object.keys(blockstate.variants)[0]]
                                    }

                                    rotation = [0, 0, 0];
                                    if (variant.hasOwnProperty("x")) {
                                        rotation[0] = variant.x;
                                    }
                                    if (variant.hasOwnProperty("y")) {
                                        rotation[1] = variant.y;
                                    }
                                    if (variant.hasOwnProperty("z")) {// Not actually used by MC, but why not?
                                        rotation[2] = variant.z;
                                    }

                                    doModelLoad(variant.model, "block");
                                }
                            } else if (blockstate.hasOwnProperty("multipart")) {

                            }
                        })
                    }

                }


            }))
        }

        Promise.all(promises).then(() => {
            if (typeof cb === "function") cb();
        })
    };

}


let parseModelType = function (string) {
    if (string.startsWith("block/")) {
        // if (type === "item") {
        //     throw new Error("Tried to mix block/item models");
        // }
        return {
            type: "block",
            model: string.substr("block/".length)
        }
    } else if (string.startsWith("item/")) {
        // if (type === "block") {
        //     throw new Error("Tried to mix item/block models");
        // }
        return {
            type: "item",
            model: string.substr("item/".length)
        }
    }
};


ModelRender.prototype.clearScene = function () {
    while (this._scene.children.length > 0) {
        this._scene.remove(this._scene.children[0]);
    }
};

ModelRender.prototype.dispose = function () {
    cancelAnimationFrame(this._animId);

    this.clearScene();

    this._canvas.remove();
    let el = this.element;
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
};

let renderModel = function (modelRender, model, textures, type, name, offset, rotation) {
    return new Promise((resolve) => {
        if (model.hasOwnProperty("elements")) {// block OR item with block parent
            // Render the elements
            let promises = [];
            for (let i = 0; i < model.elements.length; i++) {
                let element = model.elements[i];

                // // From net.minecraft.client.renderer.block.model.BlockPart.java#47 - https://yeleha.co/2JcqSr4
                let fallbackFaces = {
                    down: {
                        uv: [element.from[0], 16 - element.to[2], element.to[0], 16 - element.from[2]],
                        texture: "#down"
                    },
                    up: {
                        uv: [element.from[0], element.from[2], element.to[0], element.to[2]],
                        texture: "#up"
                    },
                    north: {
                        uv: [16 - element.to[0], 16 - element.to[1], 16 - element.from[0], 16 - element.from[1]],
                        texture: "#north"
                    },
                    south: {
                        uv: [element.from[0], 16 - element.to[1], element.to[0], 16 - element.from[1]],
                        texture: "#south"
                    },
                    west: {
                        uv: [element.from[2], 16 - element.to[1], element.to[2], 16 - element.from[2]],
                        texture: "#west"
                    },
                    east: {
                        uv: [16 - element.to[2], 16 - element.to[1], 16 - element.from[2], 16 - element.from[1]],
                        texture: "#east"
                    }
                };

                promises.push(new Promise((resolve) => {
                    createCube(element.to[0] - element.from[0], element.to[1] - element.from[1], element.to[2] - element.from[2],
                        name.replaceAll(" ", "_").replaceAll("-", "_").toLowerCase() + "_" + (element.__comment ? element.__comment.replaceAll(" ", "_").replaceAll("-", "_").toLowerCase() + "_" : "") + Date.now(),
                        element.faces, fallbackFaces, textures)
                        .then((cube) => {
                            cube.applyMatrix(new THREE.Matrix4().makeTranslation((element.to[0] - element.from[0]) / 2, (element.to[1] - element.from[1]) / 2, (element.to[2] - element.from[2]) / 2));
                            cube.applyMatrix(new THREE.Matrix4().makeTranslation(element.from[0], element.from[1], element.from[2]));

                            if (element.rotation) {
                                rotateAboutPoint(cube,
                                    new THREE.Vector3(element.rotation.origin[0], element.rotation.origin[1], element.rotation.origin[2]),
                                    new THREE.Vector3(element.rotation.axis === "x" ? 1 : 0, element.rotation.axis === "y" ? 1 : 0, element.rotation.axis === "z" ? 1 : 0),
                                    toRadians(element.rotation.angle));
                            }

                            resolve(cube);
                        })
                }));


            }

            Promise.all(promises).then((cubes) => {
                let cubeGroup = new THREE.Object3D();


                for (let i = 0; i < cubes.length; i++) {
                    cubeGroup.add(cubes[i]);

                    if (modelRender.options.showOutlines) {
                        let geo = new THREE.WireframeGeometry(cubes[i].geometry);
                        let mat = new THREE.LineBasicMaterial({color: 0x000000, linewidth: 2});
                        let line = new THREE.LineSegments(geo, mat);

                        line.position.x = cubes[i].position.x;
                        line.position.y = cubes[i].position.y;
                        line.position.z = cubes[i].position.z;

                        line.rotation.x = cubes[i].rotation.x;
                        line.rotation.y = cubes[i].rotation.y;
                        line.rotation.z = cubes[i].rotation.z;

                        line.scale.set(1.01, 1.01, 1.01);

                        cubeGroup.add(line);


                        let box = new THREE.BoxHelper(cubes[i], 0xff0000);
                        cubeGroup.add(box);
                    }

                }


                let centerContainer = new THREE.Object3D();
                centerContainer.add(cubeGroup);

                centerContainer.applyMatrix(new THREE.Matrix4().makeTranslation(-8, -8, -8));

                // Note to self: apply rotation AFTER adding objects to it, or it'll just be ignored


                // if (modelRender.options.centerCubes) {
                //     cubeContainer.applyMatrix(new THREE.Matrix4().makeTranslation(-8, -8, -8));
                // }


                let rotationContainer = new THREE.Object3D();
                rotationContainer.add(centerContainer);

                if (offset) {
                    rotationContainer.applyMatrix(new THREE.Matrix4().makeTranslation(offset[0], offset[1], offset[2]))
                }

                if (rotation) {
                    rotationContainer.rotation.set(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]));
                }


                resolve(rotationContainer);
            })
        } else {// 2d item
            createPlane(name + "_" + Date.now(), textures).then((plane) => {
                resolve(plane);
            })
        }
    })
};

let createDot = function (c) {
    let dotGeometry = new THREE.Geometry();
    dotGeometry.vertices.push(new THREE.Vector3());
    let dotMaterial = new THREE.PointsMaterial({size: 5, sizeAttenuation: false, color: c});
    return new THREE.Points(dotGeometry, dotMaterial);
};

let createPlane = function (name, textures) {
    return new Promise((resolve) => {

        let materialLoaded = function (material, width, height) {
            let geometry = new THREE.PlaneGeometry(width, height);
            let plane = new THREE.Mesh(geometry, material);
            plane.name = name;
            plane.receiveShadow = true;

            resolve(plane);
        };

        if (textures) {
            let w = 0, h = 0;
            let promises = [];
            for (let t in textures) {
                if (textures.hasOwnProperty(t)) {
                    promises.push(new Promise((resolve) => {
                        let img = new Image();
                        img.onload = function () {
                            if (img.width > w) w = img.width;
                            if (img.height > h) h = img.height;
                            resolve(img);
                        };
                        img.src = textures[t];
                    }))
                }
            }
            Promise.all(promises).then((images) => {
                let canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                let context = canvas.getContext("2d");

                for (let i = 0; i < images.length; i++) {
                    let img = images[i];
                    context.drawImage(img, 0, 0);
                }


                //TODO: figure out a good way to cache these
                new THREE.TextureLoader().load(canvas.toDataURL("image/png"), function (texture) {
                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter;
                    texture.anisotropy = 0;
                    texture.needsUpdate = true;

                    let material = new THREE.MeshBasicMaterial({
                        map: texture,
                        transparent: true,
                        side: THREE.DoubleSide,
                        alphaTest: 0.5
                    });

                    materialLoaded(material, w, h);
                });
            });
        }

    })
};


/// From https://github.com/InventivetalentDev/SkinRender/blob/master/js/render/skin.js#L353
let createCube = function (width, height, depth, name, faces, fallbackFaces, textures) {
    return new Promise((resolve) => {
        let geometry = new THREE.BoxGeometry(width, height, depth);

        let materialsLoaded = function (materials) {
            let cube = new THREE.Mesh(geometry, materials);
            cube.name = name;
            cube.receiveShadow = true;

            resolve(cube);
        };
        if (textures) {
            let promises = [];
            for (let i = 0; i < 6; i++) {
                promises.push(new Promise((resolve) => {
                    let f = FACE_ORDER[i];
                    if (!faces.hasOwnProperty(f)) {
                        console.warn("Missing face: " + f + " in model " + name);
                        resolve(null);
                        return;
                    }
                    let face = faces[f];
                    let textureRef = face.texture.substr(1);
                    if (!textures.hasOwnProperty(textureRef)) {
                        console.warn("Missing texture '" + textureRef + "' for face " + f + " in model " + name);
                        resolve(null);
                        return;
                    }

                    let img = new Image();
                    img.onload = function () {
                        let uv = face.uv;
                        if (!uv) {
                            // console.warn("Missing UV mapping for face " + f + " in model " + name + ". Using defaults");
                            uv = fallbackFaces[f].uv;
                        }

                        // Scale the uv values to match the image width, so we can support resource packs with higher-resolution textures
                        uv = [
                            scaleUv(uv[0], img.width),
                            scaleUv(uv[1], img.height),
                            scaleUv(uv[2], img.width),
                            scaleUv(uv[3], img.height)
                        ];

                        let canvas = document.createElement("canvas");
                        canvas.width = uv[2] - uv[0];
                        canvas.height = uv[3] - uv[1];
                        let context = canvas.getContext("2d");
                        context.drawImage(img, uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1], 0, 0, uv[2] - uv[0], uv[3] - uv[1]);

                        if (face.hasOwnProperty("tintindex")) {
                            context.fillStyle = TINTS[face.tintindex];
                            context.globalCompositeOperation = 'multiply';
                            context.fillRect(0, 0, uv[2] - uv[0], uv[3] - uv[1]);

                            context.globalAlpha = 1;
                            context.globalCompositeOperation = 'destination-in';
                            context.drawImage(img, uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1], 0, 0, uv[2] - uv[0], uv[3] - uv[1]);

                            // context.globalAlpha = 0.5;
                            // context.beginPath();
                            // context.fillStyle = "green";
                            // context.rect(0, 0, uv[2] - uv[0], uv[3] - uv[1]);
                            // context.fill();
                            // context.globalAlpha = 1.0;
                        }


                        // TODO: figure out a good way to cache these
                        new THREE.TextureLoader().load(canvas.toDataURL("image/png"), function (texture) {
                            texture.magFilter = THREE.NearestFilter;
                            texture.minFilter = THREE.NearestFilter;
                            texture.anisotropy = 0;
                            texture.needsUpdate = true;

                            let material = new THREE.MeshBasicMaterial({
                                map: texture,
                                transparent: true,
                                side: THREE.DoubleSide,
                                alphaTest: 0.5
                            });

                            resolve(material);
                        });
                    };
                    img.src = textures[textureRef];

                }));
            }
            Promise.all(promises).then(materials => materialsLoaded(materials))
        } else {
            let materials = [];
            for (let i = 0; i < 6; i++) {
                materials.push(new THREE.MeshBasicMaterial({
                    color: colors[i + 2],
                    wireframe: true
                }))
            }
            materialsLoaded(materials);
        }

        // if (textures) {
        //     applyCubeTextureToGeometry(geometry, texture, uv, width, height, depth);
        // }


    })
};

/// https://stackoverflow.com/questions/42812861/three-js-pivot-point/42866733#42866733
// obj - your object (THREE.Object3D or derived)
// point - the point of rotation (THREE.Vector3)
// axis - the axis of rotation (normalized THREE.Vector3)
// theta - radian value of rotation
function rotateAboutPoint(obj, point, axis, theta) {
    obj.position.sub(point); // remove the offset
    obj.position.applyAxisAngle(axis, theta); // rotate the POSITION
    obj.position.add(point); // re-add the offset

    obj.rotateOnAxis(axis, theta); // rotate the OBJECT
}

let mapUV = function (geometry, texture, uv, i) {
    //TODO: don't guess the dimensions
    let w = texture.image ? texture.image.width : 16;
    let h = texture.image ? texture.image.height : 16;


    geometry.computeBoundingBox();
    geometry.faceVertexUvs[0][i] = [];
    geometry.faceVertexUvs[0][i + 1] = [];

    let tx1 = uv[0];
    let ty1 = uv[1];
    let tx2 = uv[2];
    let ty2 = uv[3];

    let flipX = false;
    let flipY = false;

    // /// The following is pretty much just a big mess of trial-end-error to get the mapping right...
    // if (i === 0) {// right
    //     tx1 += depth + width;
    //     ty1 -= depth + height;
    //     tx2 += depth + width + depth;
    //     ty2 -= depth;
    // }
    // if (i === 1) {// left
    //     tx1 += 0;
    //     ty1 -= depth + height;
    //     tx2 += depth;
    //     ty2 -= depth;
    // }
    // if (i === 2) {// top
    //     tx1 += depth;
    //     ty1 -= depth;
    //     tx2 += depth + width;
    //     ty2 -= 0;
    // }
    // if (i === 3) {// bottom
    //     tx1 += depth + width;
    //     ty1 -= depth;
    //     tx2 += depth + width + width;
    //     ty2 -= 0;
    //     // this will probably stab me in the back at some point... plz don't hate ~haylee
    //     flipY = true;
    // }
    // if (i === 4) {// front
    //     tx1 += depth;
    //     ty1 -= depth + height;
    //     tx2 += depth + width;
    //     ty2 -= depth;
    // }
    // if (i === 5) {// back
    //     tx1 += depth + width + depth;
    //     ty1 -= depth + height;
    //     tx2 += depth + width + depth + width;
    //     ty2 -= depth;
    // }

    tx1 /= w;
    ty1 /= h;
    tx2 /= w;
    ty2 /= h;

    let faceUvs = [
        new THREE.Vector2(tx1, ty2),
        new THREE.Vector2(tx1, ty1),
        new THREE.Vector2(tx2, ty1),
        new THREE.Vector2(tx2, ty2)
    ];

    // let temp;
    // if (flipY) {
    //     temp = faceUvs[i].slice(0);
    //     faceUvs[i][0] = temp[2];
    //     faceUvs[i][1] = temp[3];
    //     faceUvs[i][2] = temp[0];
    //     faceUvs[i][3] = temp[1]
    // }
    // if (flipX) {//flip x
    //     temp = faceUvs[i].slice(0);
    //     faceUvs[i][0] = temp[3];
    //     faceUvs[i][1] = temp[2];
    //     faceUvs[i][2] = temp[1];
    //     faceUvs[i][3] = temp[0]
    // }


    geometry.faceVertexUvs[0][i] = [faceUvs[0], faceUvs[1], faceUvs[3]];
    geometry.faceVertexUvs[0][i + 1] = [faceUvs[1], faceUvs[2], faceUvs[3]];

    geometry.uvsNeedUpdate = true;
};

let loadModel = function (model, type/* block OR item */, assetRoot) {
    return new Promise((resolve, reject) => {
        if (typeof model === "string") {
            if (model.startsWith("{") && model.endsWith("}")) {// JSON string
                resolve(JSON.parse(model));
            } else if (model.startsWith("http")) {// URL
                $.ajax(model).done((data) => {
                    resolve(data);
                })
            } else {// model name -> use local data
                loadModelFromPath(assetRoot, "/assets/minecraft/models/" + (type || "block") + "/" + model + ".json").then((data) => {
                    resolve(data);
                })
            }
        } else if (typeof model === "object") {// JSON object
            resolve(model);
        } else {
            console.warn("Invalid model");
            reject();
        }
    });
};

let loadTextures = function (textureNames, assetRoot) {
    return new Promise((resolve) => {
        let promises = [];
        let filteredNames = [];

        let names = Object.keys(textureNames);
        for (let i = 0; i < names.length; i++) {
            let name = names[i];
            let texture = textureNames[name];
            if (texture.startsWith("#")) {// reference to another texture, no need to load
                continue;
            }
            filteredNames.push(name);
            promises.push(loadTextureAsBase64(assetRoot, "minecraft", "/", texture));
        }
        Promise.all(promises).then((textures) => {
            let mappedTextures = {};
            for (let i = 0; i < textures.length; i++) {
                mappedTextures[filteredNames[i]] = textures[i];
            }

            // Fill in the referenced textures
            for (let i = 0; i < names.length; i++) {
                let name = names[i];
                if (!mappedTextures.hasOwnProperty(name) && textureNames.hasOwnProperty(name)) {
                    let ref = textureNames[name].substr(1);
                    mappedTextures[name] = mappedTextures[ref];
                }
            }

            resolve(mappedTextures);
        });
    })
};


let mergeParents = function (model, assetRoot) {
    return new Promise((resolve, reject) => {
        mergeParents_(model, [], assetRoot, resolve, reject);
    });
};
let mergeParents_ = function (model, stack, assetRoot, resolve, reject) {
    stack.push(model);

    if (!model.hasOwnProperty("parent") || model["parent"] === "builtin/generated" || model["parent"] === "builtin/entity") {// already at the highest parent OR we reach the builtin parent which seems to be the hardcoded stuff that's not in the json files
        let merged = {};
        for (let i = stack.length - 1; i >= 0; i--) {
            merged = mergeDeep(merged, stack[i]);
        }

        resolve(merged);
        return;
    }

    let parent = model["parent"];
    delete model["parent"];// remove the child's parent so it will be replaced by the parent's parent

    loadModelFromPath(assetRoot, "/assets/minecraft/models/" + parent + ".json").then((parentData) => {
        let mergedModel = Object.assign({}, model, parentData);
        mergeParents_(mergedModel, stack, assetRoot, resolve, reject);
    })

};

function toRadians(angle) {
    return angle * (Math.PI / 180);
}


window.ModelRender = ModelRender;
window.ModelConverter = ModelConverter;

export default ModelRender;