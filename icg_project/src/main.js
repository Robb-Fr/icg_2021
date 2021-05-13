import { createREGL } from "../lib/regljs_2.1.0/regl.module.js";
import {
  vec2,
  vec3,
  vec4,
  mat2,
  mat3,
  mat4,
} from "../lib/gl-matrix_3.3.0/esm/index.js";
import {
  DOM_loaded_promise,
  load_text,
  load_image,
  register_button_with_hotkey,
  register_keyboard_action,
} from "./icg_web.js";
import {
  deg_to_rad,
  mat4_to_string,
  vec_to_string,
  mat4_matmul_many,
} from "./icg_math.js";
import { mesh_load_obj, icg_mesh_make_uv_sphere } from "./icg_mesh.js";
import {
  fromYRotation,
  fromZRotation,
} from "../lib/gl-matrix_3.3.0/esm/mat4.js";

import { init_light } from "./light.js";
import { init_scene } from "./scene.js";

async function main() {
  /* const in JS means the variable will not be bound to a new value, but the value can be modified (if its an object or array)
		https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/const
	*/

  // We are using the REGL library to work with webGL
  // http://regl.party/api
  // https://github.com/regl-project/regl/blob/master/API.md
  const regl = createREGL({
    profile: true, // if we want to measure the size of buffers/textures in memory
    extensions: ["oes_texture_float"], // float textures
  });
  // The <canvas> (HTML element for drawing graphics) was created by REGL, lets take a handle to it.
  const canvas_elem = document.getElementsByTagName("canvas")[0];

  const debug_overlay = document.getElementById("debug-overlay");
  const debug_text = document.getElementById("debug-text");

  /*---------------------------------------------------------------
		Resource loading
	---------------------------------------------------------------*/

  /*
	The textures fail to load when the site is opened from local file (file://) due to "cross-origin".
	Solutions:
	* run a local webserver
		python -m http.server 8000
		# open localhost:8000
	OR
	* run chromium with CLI flag
		"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --allow-file-access-from-files index.html

	* edit config in firefox
		security.fileuri.strict_origin_policy = false
	*/

  // Start downloads in parallel
  const resources = {
    shader_shadowmap_gen_vert: load_text(
      "./src/shaders/shadowmap_gen.vert.glsl"
    ),
    shader_shadowmap_gen_frag: load_text(
      "./src/shaders/shadowmap_gen.frag.glsl"
    ),

    shader_ambient_vert: load_text("./src/shaders/ambient_color.vert.glsl"),
    shader_ambient_frag: load_text("./src/shaders/ambient_color.frag.glsl"),
    shader_phong_shadow_vert: load_text("./src/shaders/phong_shadow.vert.glsl"),
    shader_phong_shadow_frag: load_text("./src/shaders/phong_shadow.frag.glsl"),

    //'mesh_scene': load_mesh_obj(regl, './meshes/shadow_scene_1.obj'),
    mesh_terrain: mesh_load_obj(regl, "./meshes/shadow_scene__terrain.obj", {
      mat_architecture: [0.79, 0.41, 0.31],
      mat_terrain: [0.9, 0.7, 0.4],
      mat_screen: [0.31, 0.84, 0.42],
    }),

    mesh_wheel: mesh_load_obj(regl, "./tiles/tile_1_middle_nr.obj", {
      palette: [1, 1, 1],
    }),
  };

  // Not used, kept for the snippet in case of.
  /*
	for(let cube_side = 0; cube_side < 6; cube_side++) {
		resources[`tex_cube_side_${cube_side}`] = load_image(`./textures/cube_side_${cube_side}.png`);
	}
	*/

  // Wait for all downloads to complete
  for (const key in resources) {
    if (resources.hasOwnProperty(key)) {
      resources[key] = await resources[key];
    }
  }

  /*---------------------------------------------------------------
		Camera
	---------------------------------------------------------------*/
  const mat_world_to_cam = mat4.create();
  const cam_distance_base = 15;

  let cam_angle_z = Math.PI / 5; // in radians!
  let cam_angle_y = -Math.PI / 6; // in radians!
  let cam_distance_factor = 1;

  let cam_target = [0, 0, 0];

  function update_cam_transform() {
    /* Calculate the world-to-camera transformation matrix.
		The camera orbits the scene
		* cam_distance_base * cam_distance_factor = distance of the camera from the (0, 0, 0) point
		* cam_angle_z - camera ray's angle around the Z axis
		* cam_angle_y - camera ray's angle around the Y axis

		* cam_target - the point we orbit around
		*/

    // Example camera matrix, looking along forward-X, edit this
    const look_at = mat4.lookAt(
      mat4.create(),
      [-(cam_distance_base * cam_distance_factor), 0, 0], // camera position in world coord (distance to 'from' point), as forward-X we move along X axis
      cam_target, // view target point (always look at the origin)
      [0, 0, 1] // up vector (simply goes along +z axis, unit vector)
    );
    // Store the combined transform in mat_world_to_cam
    // mat_world_to_cam = look_at * rotation_Y * rotation_Z
    mat4_matmul_many(
      mat_world_to_cam,
      look_at,
      fromYRotation(mat4.create(), cam_angle_y),
      fromZRotation(mat4.create(), cam_angle_z)
    ); // edit this
  }

  update_cam_transform();

  // Rotate camera position by dragging with the mouse
  canvas_elem.addEventListener("mousemove", (event) => {
    // if left or middle button is pressed
    if (event.buttons & 1 || event.buttons & 4) {
      if (event.shiftKey) {
        const r = mat2.fromRotation(mat2.create(), -cam_angle_z);
        const offset = vec2.transformMat2(
          [0, 0],
          [event.movementY, event.movementX],
          r
        );
        vec2.scale(offset, offset, -0.01);
        cam_target[0] += offset[0];
        cam_target[1] += offset[1];
      } else {
        cam_angle_z += event.movementX * 0.005;
        cam_angle_y += -event.movementY * 0.005;
      }
      update_cam_transform();
    }
  });

  canvas_elem.addEventListener("wheel", (event) => {
    // scroll wheel to zoom in or out
    const factor_mul_base = 1.08;
    const factor_mul = event.deltaY > 0 ? factor_mul_base : 1 / factor_mul_base;
    cam_distance_factor *= factor_mul;
    cam_distance_factor = Math.max(0.1, Math.min(cam_distance_factor, 4));
    // console.log('wheel', event.deltaY, event.deltaMode);
    event.preventDefault(); // don't scroll the page too...
    update_cam_transform();
  });

  /*---------------------------------------------------------------
		Actors
	---------------------------------------------------------------*/

  const { actors, update_simulation, render_ambient } = init_scene(
    regl,
    resources
  );

  const Light = init_light(regl, resources);

  const lights = [
    new Light({
      update: (light, { sim_time }) => {
        light.position = [
          0.1,
          Math.sin(sim_time * 0.5) * 12,
          Math.cos(sim_time * 0.5) * 12,
        ];
      },
      color: [1, 1, 1],
      intensity: 20,
    }),
    new Light({
      position: [0.1, -4, 5],
      color: [1, 1, 1],
      intensity: 20,
    }),
	new Light({
		position: [0.1, -0.1, -7],
		color: [0.9, 0.9, 0.9],
		intensity: 15,
	  })
  ];

  /*
		UI
	*/
  let sim_time = 0;
  let prev_regl_time = 0;

  let is_paused = false;
  register_button_with_hotkey("btn-pause", "p", () => {
    is_paused = !is_paused;
	console.log('game paused:',is_paused);
  });

  let render_stoped = false;
  register_button_with_hotkey("btn-stop", "s", () => {
    render_stoped = !render_stoped;
	if(!render_stoped){
		activate_preset_view();
		is_paused = false;
		console.log('game paused:',is_paused);
	}
    console.log("render stopped:",render_stoped);
  });

  register_keyboard_action("z", () => {
    debug_overlay.classList.toggle("hide");
  });

  function activate_preset_view() {
    is_paused = true;
	console.log('game paused:',is_paused);
    sim_time = 24.0;
    cam_angle_z = -Math.PI * 0.5;
    cam_angle_y = -Math.PI * (1 / 6);
    cam_distance_factor = 0.8;
    cam_target = [0, 0, 0];

    update_cam_transform();
  }
  register_button_with_hotkey("btn-preset-view", "c", activate_preset_view);

  /*---------------------------------------------------------------
		Frame render
	---------------------------------------------------------------*/
  const mat_projection = mat4.create();
  const mat_view = mat4.create();

  regl.frame((frame) => {
    if (!render_stoped) {
      if (!is_paused) {
        const dt = frame.time - prev_regl_time;
        sim_time += dt;
      }
      prev_regl_time = frame.time;

      mat4.perspective(
        mat_projection,
        deg_to_rad * 60, // fov y
        frame.framebufferWidth / frame.framebufferHeight, // aspect ratio
        0.01, // near
        100 // far
      );

      mat4.copy(mat_view, mat_world_to_cam);

      var active_mat_view = mat_view;
      var active_mat_projection = mat_projection;

      for (const light of lights) {
        light.update_simulation({ sim_time: sim_time });
      }
      update_simulation({ sim_time: sim_time, actors: actors });

      const scene_info = {
        sim_time: sim_time,
        mat_view: active_mat_view, // can differ from mat_view for debugging!
        scene_mat_view: mat_view,
        mat_projection: active_mat_projection, // can differ from mat_projection for debugging!
        actors: actors,
        ambient_light_color: vec3.fromValues(0.5, 0.5, 0.5),
      };

      // Set the whole image to black
      regl.clear({ color: [0, 0.65, 1, 1] });

      render_ambient(scene_info);

      for (const light of lights) {
        light.render_shadowmap(scene_info);
        light.draw_phong_contribution(scene_info);
      }

      // 		debug_text.textContent = `
      // Hello! Sim time is ${sim_time.toFixed(2)} s
      // Camera: angle_z ${(cam_angle_z / deg_to_rad).toFixed(1)}, angle_y ${(cam_angle_y / deg_to_rad).toFixed(1)}, distance ${(cam_distance_factor*cam_distance_base).toFixed(1)}
      // `;
    }
  });
}
DOM_loaded_promise.then(main);