"use strict";

const S01_PARTS = [
  ["Calf_Main", "小腿板"], ["Foot", "脚掌"], ["Ankle_Lugs", "脚踝铰耳"],
  ["Ankle_Cross", "脚踝小鸟"], ["Ankle_Seat", "踝关节铰座"], ["Knee_Clamp", "膝端抱箍"],
  ["Upper_Stop", "上硬限位"], ["Lower_Stop", "下硬限位"], ["Pitch_Stop_Pin", "PITCH 限位轴"]
];
const S01_PROBES = [
  ["Knee_Force_Reaction", "膝端支承反力", false], ["Knee_Moment_Reaction", "膝端支承反力矩", true],
  ["Pitch_Pose_Hold_Force", "俯仰关节传力", false], ["Pitch_Pose_Hold_Moment", "俯仰关节传递力矩", true],
  ["Roll_Pose_Hold_Force", "侧倾关节传力", false], ["Roll_Pose_Hold_Moment", "侧倾关节传递力矩", true]
];
const COMMON_VIEWS = {
  displacement: ["displacement_magnitude_iso.png", "总变形云图", "颜色单位 mm，未变形几何"],
  stress: ["equivalent_stress_iso.png", "等效应力云图", "节点结果，单位 MPa，未变形几何"],
  front: ["equivalent_stress_front.png", "正视等效应力云图", "节点结果，单位 MPa，未变形几何"],
  side: ["equivalent_stress_side.png", "侧视等效应力云图", "节点结果，单位 MPa，未变形几何"],
  "true-scale": ["displacement_true_scale_iso.png", "实际变形", "变形比例 1，颜色单位 mm"]
};
const C01_PARTS = [["Calf_Main","小腿板"],["Ankle_Lugs","脚踝铰耳"],["Knee_Clamp","膝端抱箍"],["Upper_Stop","上硬限位"],["Lower_Stop","下硬限位"],["Sleeve_A","铜套 A"],["Sleeve_B","铜套 B"]];
const C01_PROBES = S01_PROBES.slice(0,2);
let rootData = null, data = null, selectedStudy = "S01", selectedCase = "8000", selectedView = "displacement", imageGeneration=0;
let PARTS=S01_PARTS,PROBES=S01_PROBES,VIEWS=viewsForStudy("S01");
const downloadingCases = new Set();
const downloadStates = new Map();
const $ = (id) => document.getElementById(id);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

function format(v, digits = 3) {
  if (!finite(v)) return "未记录";
  if (v === 0) return "0";
  if (Math.abs(v) < 0.001) return v.toExponential(2).replace("e-", "e−").replace("e+", "e+");
  if (Number.isInteger(v) && Math.abs(v) >= 10000) return v.toLocaleString("en-US");
  return v.toLocaleString("en-US", {maximumFractionDigits: digits, minimumFractionDigits: 0});
}
function html(value) { return String(value ?? "未记录").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function row(label, values, numeric = true) { return `<tr><td>${html(label)}</td>${values.map(v => `<td${numeric ? ' class="num"' : ""}>${html(finite(v) ? format(v, 6) : v)}</td>`).join("")}</tr>`; }
function safeURL(value) {
  if (typeof value !== "string" || /^(?:file:|javascript:|data:)|^[a-z]:[\\/]|\\|\.\./i.test(value)) return null;
  if (value.startsWith("assets/") || /^https:\/\//i.test(value)) return value;
  return null;
}
function viewsForStudy(study) {
  const views={...COMMON_VIEWS},parts=study==="C01"?C01_PARTS:S01_PARTS;
  if(study==="C01") {
    views["sleeve-a-y"]=["sleeve_a_directional_displacement_Y.png","铜套 A 竖直位移","CAD Y 分量，向上为 −Y，单位 mm"];
    views["sleeve-b-y"]=["sleeve_b_directional_displacement_Y.png","铜套 B 竖直位移","CAD Y 分量，向上为 −Y，单位 mm"];
    views["geometry"]=["solid_geometry_iso.png","七实体几何全景","未变形有限元边界，无结果色标"];
  }
  else views["foot-y"]=["foot_directional_displacement_Y.png","足底 Y 方向位移","单位 mm，全局 −Y 向上，未变形几何"];
  parts.forEach(([key,label])=>{views[`part-${key}`]=[`part_stress_${key}.png`,`${label}等效应力`,"单位 MPa，该零件使用独立自动色标，不能仅凭颜色比较不同零件"];});
  return views;
}
function studyData(study) { return rootData?.studies ? rootData.studies[study]||{} : study==="S01"?rootData||{}:{}; }
function casesOf(source=data) {
  if (Array.isArray(source?.cases)) return Object.fromEntries(source.cases.map(c => [String(c.load_N), c]));
  return source?.cases || {"4000":source?.results_4000, "8000":source?.results_8000};
}
function validCase(c, load, study=selectedStudy) {
  const probes=study==="C01"?C01_PROBES:S01_PROBES;
  const base=c?.solution_status === "Done" && c.load_N === Number(load) && probes.every(([name]) => c.probes?.[name]?.is_solved === true) && Object.values(c.probes).every(p => p?.is_solved === true);
  if(!base||study!=="C01")return base;
  const beams=beamRowsOf(c),names=new Set(beams.map(b=>b.id||b.name));
  return c.study_id==="C01"&&Object.keys(c.probes).length===2&&finite(c.max_total_deformation_mm)&&finite(c.max_equivalent_stress_MPa)
    &&C01_PROBES.every(([name])=>c.probes[name].components_frame==="global_X_Y_Z"&&["x","y","z","total"].every(key=>finite(c.probes[name][key])))
    &&C01_PARTS.every(([key])=>["maximum","average"].every(field=>finite(c.part_stress_MPa?.[key]?.[field])))
    &&["Sleeve_A","Sleeve_B"].every(key=>sleeveUpBounds(c,key).every(finite))
    &&c.beam_data_source?.raw_reader_verified===true&&typeof c.beam_data_source.native_probe_magnitudes_agree==="boolean"
    &&c.beam_result_frame==="actual_BEAM188_local_I_J"&&beams.length===8&&names.size===8
    &&Array.from({length:8},(_,i)=>`Bolt_${String(i+1).padStart(2,"0")}`).every(name=>names.has(name))
    &&beams.every(b=>b.is_solved===true&&["axial_force_N","shear_y_N","shear_z_N","bending_y_Nmm","bending_z_Nmm","torsion_Nmm","equivalent_stress_MPa"].every(key=>finite(b[key])));
}
function currentCase() { const c = casesOf()[selectedCase]; return validCase(c, selectedCase) ? c : null; }
function probeValue(c, name, component, moment = false) {
  const p = c?.probes?.[name];
  if (!p?.is_solved || !finite(p[component])) return null;
  if (component !== "total" && p.components_frame !== "global_X_Y_Z") return null;
  const unit = String(p.unit).toLowerCase().replace(/[ *·]/g, "");
  if (!moment) return unit === "n" ? p[component] : null;
  return ["nmm","n-mm"].includes(unit) ? p[component] / 1000 : ["nm","n-m"].includes(unit) ? p[component] : null;
}
function materialFor(key) {
  if (Array.isArray(data?.materials)) return data.materials.find(m => m.part === key || m.key === key || m.name === key || m.part_key === key) || {};
  return data?.materials?.[key] || data?.body_materials?.[key] || {};
}

function sleeveUpBounds(c,key) {
  const up=c?.sleeve_displacement_up_mm?.[key];if(up)return [up.minimum,up.maximum];
  const y=c?.sleeve_displacement_Y_mm?.[key]||c?.sleeve_displacement_Y?.[key]||{};
  const min=y.minimum??c?.[`${key}_displacement_Y_min_mm`],max=y.maximum??c?.[`${key}_displacement_Y_max_mm`];
  return [finite(max)?-max:null,finite(min)?-min:null];
}
function beamRowsOf(c) {
  const records=c?.beam_results||c?.beams||[];
  return Array.isArray(records)?records:Object.entries(records).map(([id,b])=>({id,...b}));
}
function solidMeshLabel() {
  const value=data?.mesh?.element_order||data?.mesh?.controls?.element_order;
  if(typeof value==="string"&&/linear/i.test(value))return "一阶四面体（Tet4）";
  return value||"一阶四面体（本轮资源试算输入）";
}
function renderBeams(c) {
  const beams=beamRowsOf(c);
  const source=c?.beam_data_source||{},mismatch=source.native_probe_magnitudes_agree===false;
  $("beam-data-source").textContent=c?"梁数值来源：独立 DPF RST / BEAM188 SMISC，逐元素 ID 与 I/J 端点核验。原始力单位 N、力矩单位 N·mm；表内力矩转为 N·m。":"梁数值来源待核对；只接受实际 RST 的独立 DPF BEAM188 SMISC。";
  $("beam-native-warning").hidden=!c||!mismatch;
  $("beam-native-warning-text").textContent=mismatch?`${source.native_probe_all_zero?"原生 LOCAL BeamProbe 六项标量均为 0，":"原生 LOCAL BeamProbe 与实际 RST 内力读值不一致，"}原生比对未通过。下表使用经独立核验的 DPF SMISC 两端内力；原生值、所有差异与真实来源均保留在对照 JSON，不把零读值解释为零内力。`:"";
  const comparisonURL=assetURL(source.native_comparison_href);$("beam-native-comparison-link").hidden=!comparisonURL;
  if(comparisonURL)$("beam-native-comparison-link").href=comparisonURL;
  const moment=(b,keys)=>{for(const key of keys){if(finite(b[key]))return key.endsWith("_Nmm")?b[key]/1000:b[key];}return null;};
  $("beam-rows").innerHTML=Array.from({length:8},(_,index)=>{
    const id=`Bolt_${String(index+1).padStart(2,"0")}`,b=beams.find(v=>v.id===id||v.name===id||v.number===index+1)||{};
    const solved=!!c&&b.is_solved===true;
    const diameter=b.diameter_mm??data?.model?.beam_trial?.diameter_mm??3;
    return row(id,[b.envelope_end,diameter,b.length_mm,solved?b.axial_force_N:null,solved?b.shear_y_N:null,solved?b.shear_z_N:null,solved?moment(b,["bending_y_Nmm","bending_y_Nm"]):null,solved?moment(b,["bending_z_Nmm","bending_z_Nm"]):null,solved?moment(b,["torsion_Nmm","torsion_Nm"]):null,solved?b.equivalent_stress_MPa:null]);
  }).join("");
}

function renderResults() {
  const c = currentCase();
  $("parts-case").textContent = `${selectedStudy} · ${selectedCase} N ${selectedCase === "8000" ? "主载荷" : "对照"}`;
  $("case-status").textContent = c ? `${selectedStudy} · ${selectedCase} N · ${selectedStudy==="C01"?"资源诊断求解完成 / 未网格收敛":"求解完成 / 探针已核对"}` : `${selectedStudy} · ${selectedCase} N · 待求解`;
  $("metric-displacement").textContent = c ? format(c.max_total_deformation_mm) : "—";
  $("metric-stress").textContent = c ? format(c.max_equivalent_stress_MPa) : "—";
  $("metric-force").textContent = c ? format(probeValue(c, "Knee_Force_Reaction", "y")) : "—";
  $("metric-balance").textContent = c ? format(finite(c.force_balance_relative_error) ? c.force_balance_relative_error * 100 : null) : "—";
  if(selectedStudy==="C01")$("foot-rows").innerHTML=["Sleeve_A","Sleeve_B"].map((key,index)=>{const [min,max]=sleeveUpBounds(c,key);return row(`铜套 ${index?"B":"A"} 向上最小值`,[min])+row(`铜套 ${index?"B":"A"} 向上最大值`,[max]);}).join("");
  else $("foot-rows").innerHTML = row("Y 位移最小值", [c?.foot_displacement_Y_min_mm]) + row("Y 位移最大值", [c?.foot_displacement_Y_max_mm]);
  $("joint-rows").innerHTML = row("俯仰轴向 Mx", [probeValue(c, "Pitch_Pose_Hold_Moment", "x", true)]) + row("俯仰关节力矩合量", [probeValue(c, "Pitch_Pose_Hold_Moment", "total", true)]) + row("侧倾轴向 Mz", [probeValue(c, "Roll_Pose_Hold_Moment", "z", true)]) + row("侧倾关节力矩合量", [probeValue(c, "Roll_Pose_Hold_Moment", "total", true)]);
  $("probe-rows").innerHTML = PROBES.map(([key,label,moment]) => row(label, ["x","y","z","total"].map(axis => probeValue(c,key,axis,moment))).replace("</tr>",`<td>${moment ? "N·m" : "N"}</td></tr>`)).join("");
  $("part-rows").innerHTML = PARTS.map(([key,label]) => {
    const stress = c?.part_stress_MPa?.[key] || {}, material = materialFor(key), yieldMPa = material.yield_MPa ?? material.nominal_yield_MPa ?? material.yield_strength_MPa;
    const above = finite(stress.maximum) && finite(yieldMPa) && stress.maximum > yieldMPa;
    const flag = !finite(yieldMPa) || !finite(stress.maximum) ? "参考值未记录" : above ? "峰值超过名义参考" : "峰值未超过名义参考";
    return `<tr><td><button type="button" class="part-image-link" data-part-view="part-${key}">${html(label)} ↗</button><small>${key}</small></td><td class="num">${format(stress.maximum)}</td><td class="num">${format(stress.average)}</td><td>${html(material.material || material.grade || material.material_name || "未记录")}</td><td class="num">${format(yieldMPa)}</td><td><span class="flag${above ? " above" : ""}">${flag}</span></td></tr>`;
  }).join("");
  if(selectedStudy==="C01")renderBeams(c);
  renderImage();
}

function imageFor() {
  const [filename,label,caption] = VIEWS[selectedView];
  const pp = data?.postprocess?.[selectedCase];
  const images = pp?.images || data?.images?.[selectedCase] || [];
  const item = Array.isArray(images) ? images.find(v => v.id === selectedView || v.view === selectedView || v.src?.endsWith(filename) || v.filename === filename) : null;
  const path = item?.src || item?.path || `${selectedStudy==="C01"?"assets/C01":"assets"}/${selectedCase}/${filename}`;
  return {src:safeURL(path),label:item?.label || label,caption:item?.caption || caption};
}
function renderImage() {
  const image = imageFor(), c = currentCase(), img = $("cloud-image"), placeholder = $("image-placeholder"), generation=++imageGeneration;
  img.onload=null;img.onerror=null;img.removeAttribute?.("src");
  $("cloud-title").textContent = `${selectedStudy} · ${selectedCase} N · ${image.label}`;
  $("cloud-caption").textContent = image.caption;
  img.hidden = true; placeholder.hidden = false;
  $("image-open").disabled = true;
  const summary = data?.postprocess?.[selectedCase]?.summary;
  const invalidPostprocess = summary && (summary.status !== "complete" || summary.source_unchanged_during_read !== true || (finite(summary.load_label_N) && summary.load_label_N !== Number(selectedCase)));
  if (!c || !image.src || invalidPostprocess) { placeholder.textContent = "没有可核对的已完成求解云图"; return; }
  placeholder.textContent = "正在载入工况云图…";
  img.onload = () => {if(generation!==imageGeneration)return;img.hidden = false;placeholder.hidden = true;$("image-open").disabled = false;};
  img.onerror = () => {if(generation!==imageGeneration)return;img.hidden = true;placeholder.hidden = false;placeholder.textContent = "该视图尚未提供";$("image-open").disabled = true;};
  img.alt = `${selectedCase} N，${image.label}，${image.caption}`;
  img.src = image.src;
}

function renderVerification() {
  const verification = data?.verification || {}, cases = verification.cases || {}, mesh = data?.mesh || data?.mesh_summary || {}, checkRoot = data?.solver_checks || {}, checks = checkRoot[selectedCase] || checkRoot.cases?.[selectedCase] || checkRoot, current = currentCase();
  const controls=mesh.controls||{},c01=selectedStudy==="C01";
  const method=controls.method_by_part||controls.methods||controls.method;
  const methodLabel=typeof method==="string"?method:method&&typeof method==="object"?Object.entries(method).map(([key,value])=>`${key}: ${typeof value==="string"?value:JSON.stringify(value)}`).join("；"):"未记录";
  const warningEvidence=mesh.solver_warnings?.[selectedCase]||checks.solver_warning_evidence||{};
  const entries = [
    [c01?"三维实体物理节点数":"节点数", mesh.physical_solid_node_count??mesh.node_count??current?.node_count],
    ["三维实体网格单元数", mesh.solid_element_count??mesh.element_count??current?.element_count],
    ...(c01?[["RST 总节点数",mesh.rst_total_node_count],["RST 总单元数",mesh.rst_total_element_count],["RST 辅助节点 / 辅助单元",`${format(mesh.auxiliary_rst_node_count)} / ${format(mesh.auxiliary_rst_element_count)}`]]:[]),
    [c01?"实体单元阶次":"单元阶次", c01?solidMeshLabel():mesh.element_order||"二次"],
    ...(c01?[["实体网格方法",methodLabel]]:[]),
    ["全局 / 小腿板尺寸", c01?`${format(controls.global_size_mm)} / ${format(controls.calf_size_mm)} mm`:"3.0 / 3.0 mm"],
    [c01?"铰耳 / 铜套尺寸":"脚掌 / 铰耳 / 铰座 / 小鸟", c01?`${format(controls.lugs_size_mm)} / ${format(controls.sleeve_size_mm)} mm`:"2.0 mm"],
    ...(c01?[["抱箍 / 限位附件尺寸",`${format(controls.clamp_size_mm)} / ${format(controls.stops_size_mm)} mm`],["螺栓孔面 / 配合面尺寸",`${format(controls.bolt_face_size_mm)} / ${format(controls.mount_mating_face_size_mm)} mm`],["增长率",controls.growth_rate],["保存结果时点",data?.model?.saved_result_time_points||"待记录"],["网格用途",mesh.purpose||"资源约束下的诊断试算；未验证收敛"]]:[]),
    ["MinimumSize / 曲率捕捉", c01?`${format(controls.minimum_size_mm)} mm / ${controls.curvature===true?`${format(controls.curvature_angle_deg)}°`:controls.curvature===false?"关闭":"未记录"}`:"0.5 mm / 30°"],
    ["Proximity / Adaptive", c01?[controls.proximity,controls.adaptive].map(v=>v===true?"开启":v===false?"关闭":"未记录").join(" / "):"关闭 / 关闭"], ["求解器", data?.model?.solver || (c01?"待记录":"Direct · SMP · Out-of-Core")],
    ...(c01?[["本档求解器存储模式",data?.model?.solver_config?.memory_mode_by_load?.[selectedCase]||"未记录"]]:[]),
    ["形状检查单元数", checks.checked_element_count ?? checks.shape_checked_element_count], ["形状警告单元数", checks.shape_warning_count],
    ["CHECK 形状错误 / 报告负 Jacobian", `${finite(checks.shape_error_count) ? checks.shape_error_count : "未记录"} / ${finite(checks.negative_jacobian_count) ? checks.negative_jacobian_count : "未记录"}`],
    ["求解错误数", checks.error_count], ["网格收敛", "尚未验证"]
  ];
  if(c01)entries.splice(entries.length-1,0,
    ["原生日志追踪的形状警告单元数",warningEvidence.shape_warning_element_count],
    ["原生日志 ERROR / FATAL 消息数",`${finite(warningEvidence.error_message_count)?warningEvidence.error_message_count:"未记录"} / ${finite(warningEvidence.fatal_message_count)?warningEvidence.fatal_message_count:"未记录"}`],
    ["严重求解/形状消息数",warningEvidence.critical_solver_message_count],
    ["警告单元实测非正体积数",warningEvidence.critical_measured_nonpositive_volume_count],
    ["警告归属追踪",warningEvidence.attribution_status||"未记录"],
    ["梁内力来源",current?.beam_data_source?.value_source||"未记录"],
    ["原生 BeamProbe 对照",current?.beam_data_source?.native_probe_magnitudes_agree===false?"读值不一致；原生值与差异已披露":current?.beam_data_source?.native_probe_magnitudes_agree===true?"数值一致":"未记录"]);
  $("mesh-rows").innerHTML = entries.map(([label,value]) => row(label,[value],true)).join("");
  const verifiedCase = load => {const c=cases[load], record=casesOf()[load];return validCase(record,load)&&c?.status_verified===true&&c?.all_probes_solved===true?c:null;};
  const c4 = verifiedCase("4000"), c8 = verifiedCase("8000");
  const eqValue = (c, key) => finite(c?.equilibrium_relative_errors?.[key]) ? c.equilibrium_relative_errors[key] * 100 : null;
  $("equilibrium-rows").innerHTML = row("力平衡误差 / %", [eqValue(c4,"force_relative"),eqValue(c8,"force_relative")]) + row("力矩平衡误差 / %", [eqValue(c4,"moment_relative"),eqValue(c8,"moment_relative")]);
  if(c01)$("equilibrium-rows").innerHTML += ["x","y","z","total"].map(axis=>row(`支承力矩 ${axis} / N·m`,[probeValue(c4?casesOf()["4000"]:null,"Knee_Moment_Reaction",axis,true),probeValue(c8?casesOf()["8000"]:null,"Knee_Moment_Reaction",axis,true)])).join("");
  else $("equilibrium-rows").innerHTML+=row("俯仰轴向力矩 / N·m",[c4?.pitch_axial_pose_moment_Nm,c8?.pitch_axial_pose_moment_Nm]) + row("侧倾轴向力矩 / N·m",[c4?.roll_axial_pose_moment_Nm,c8?.roll_axial_pose_moment_Nm]);
  const origin = c01?(current?.probes?.Knee_Moment_Reaction?.summation_origin_global_mm||verification.reaction_moment_summation_point_mm):verification.support_moment_summation_point_mm;
  $("moment-origin").textContent = Array.isArray(origin) ? `${c01?"本轮反力矩探针按实际记录的全局求和点":"力矩求和点为支承面的面积加权中心"} (${origin.map(v=>format(v,6)).join(", ")}) mm${c01&&origin.every(v=>v===0)?"，即全局原点":""}。理论支承力矩为 −Σ(r × F)；首轮平衡目标小于 1%。` : "力矩求和点记录尚未提供。";
  const ratios = verification.load_ratio_8000_over_4000 || {};
  const names = {max_total_deformation_mm:"最大总变形",max_equivalent_stress_MPa:"全模型最大等效应力",foot_displacement_Y_min_mm:"足底 Y 最小位移",foot_displacement_Y_max_mm:"足底 Y 最大位移",sleeve_up_Sleeve_A:"铜套 A 平均向上位移",sleeve_up_Sleeve_B:"铜套 B 平均向上位移",...Object.fromEntries(PARTS.map(([k,n])=>[`stress_${k}`,`${n}最大等效应力`]))};
  $("ratio-rows").innerHTML = verification.both_load_levels_verified && validCase(casesOf()["4000"],4000) && validCase(casesOf()["8000"],8000) && Object.keys(ratios).length ? Object.entries(ratios).map(([key,value])=>row(names[key]||key,[c01&&value===null?"未定义（基准响应近零）":value,2,finite(value)?Math.abs(value/2-1)*100:null])).join("") : '<tr><td colspan="4">两载荷比例验证尚未记录</td></tr>';
  const geometry = data?.geometry_checks || data?.geometry || {}, pp = data?.postprocess?.["8000"]?.summary || data?.postprocess?.["4000"]?.summary || {}, calf = pp.calf_volume_check || {};
  const ocp = geometry.ocp_calf_volume_mm3 ?? geometry.reference_ocp_volume_mm3 ?? calf.reference_ocp_volume_mm3;
  const dpf = geometry.dpf_calf_volume_mm3 ?? geometry.fe_calf_volume_mm3 ?? calf.dpf?.total_volume_mm3;
  const native = geometry.mechanical_calf_volume_mm3 ?? geometry.native_calf_volume_mm3 ?? calf.reference_mechanical_geometry_report_mm3;
  const relative = v => finite(v)&&finite(ocp)&&ocp!==0?(v/ocp-1)*100:null;
  $("volume-rows").innerHTML = row("OCP 源 CAD BRep",[ocp,finite(ocp)?0:null]) + row("DPF 有限元形函数积分",[dpf,relative(dpf)]) + row("Mechanical 原生几何质量接口",[native,relative(native)]);
  const sampled=mesh.sampled_quadratic_tet_jacobians||pp.mesh?.sampled_quadratic_tet_jacobians;
  $("mesh-sampling-note").textContent=c01?(sampled?.status==="measured"&&finite(sampled.element_count)&&sampled.element_count>0?`本轮实际 Tet10 单元的有限采样记录见下载。它不证明单元内处处为正，也不替代网格收敛。`:`本轮实体为${solidMeshLabel()}资源诊断试算，未网格收敛。没有实际 Tet10 单元采样时该检查不适用，不能把零采样数量解释为质量通过；原生形状警告和实体体积另见日志与 DPF 证据。`):(sampled?.limitation||"DPF 对 757838 个二次实体单元各取 9 点检查，采样 Jacobian 均为正。有限采样不能证明单元内处处为正，也不替代网格收敛。");
}

function renderStudyContext() {
  const c01=selectedStudy==="C01";
  $("study-subject").textContent=c01?"X1 小腿 · 两铜套与梁螺栓试验":"X1 左小腿与脚踝装配";
  $("study-date").textContent=data?.date||(c01?"2026.10.14":"2026.10.13");
  $("study-title").innerHTML=c01?"<span>C01</span> 铜套加载<br>资源诊断试验":"<span>S01</span> 直立静力学<br>首轮结果";
  $("study-description").innerHTML=c01?"两个铜套内孔分别加载。<br>8000 N 主载荷：每孔 4000 N；<br>4000 N 对照：每孔 2000 N。":"直立 0°，足部水平。<br>查看 8000 N 主载荷与 4000 N 对照，<br>以及模型等效、传力与验证记录。";
  $("study-scope").textContent=c01?`${solidMeshLabel()}资源诊断试算，未网格收敛，不作为规划二次网格验收。安装板配合面允许分离与滑移，无预紧；螺栓规格与材料等级未确认，当前结果不作设计安全验收。`:"保持姿态的线弹性基线。网格收敛、塑性、大变形及实际驱动传力尚未验证，当前结果不作设计安全验收。";
  for(const id of ["c01-trial-banner","c01-beam-panel","c01-model-details"])$(id).hidden=!c01;
  for(const id of ["s01-joint-panel","s01-model-details"])$(id).hidden=c01;
  $("parts-title").textContent=`${PARTS.length} 个承载零件的应力`;
  $("load-location-note").textContent=c01?"两个铜套完整内孔，每孔一个合力":"压力中心：用户确认的足底面中心";
  $("displacement-table-title").textContent=c01?"铜套向上位移":"足底竖直位移";
  $("displacement-direction-note").textContent=c01?"向上位移 = −CAD Y 位移；最小/最大值据此换向。未求解时不显示数值。":"全局 −Y 向上；位移符号按 CAD 全局坐标记录。";
  $("model-context").textContent=c01?`7 实体 · ${solidMeshLabel()} · 8 根 BEAM188 · 无预紧 · 未网格收敛`:"直立 0° · 足部水平";
  $("ratio-note").textContent=c01?"Frictionless 配合可开离或滑移，接触状态变化时响应不必严格为两倍；应结合接触状态解释比例，不把它当作网格收敛或强度通过证据。":"同一边界与接触等效下的两倍响应检查仅验证线性载荷比例，不代替粗、中、细网格收敛，也不能证明塑性或大变形适用性。";
  $("volume-note").textContent=c01?"仅采用 C01 本轮的 CAD 与有限元体积记录；尚未测量的字段不借用 S01 数值。体积一致不能单独证明局部几何或接触准确。":"有限元单元形函数积分与 OCP 体积基本一致。原生几何质量接口偏差保留为度量记录，不把 +2.6316% 当作实际导入几何增量；体积核对也不能单独证明局部几何精度。";
  const limits=c01?["本轮一阶四面体只作资源诊断，需复核单元阶次、薄壁厚度分辨率和粗、中、细网格收敛。","铜套屈服强度与实际螺栓规格、等级及有效螺纹面积。","实际配合间隙、螺栓预紧及摩擦对安装板传力的影响。","大变形、塑性与接触开离对结果的影响。","允许位移和正式设计验收依据。"]:["约 2 mm 小腿薄壁的厚度分辨率与粗、中、细网格收敛。","材料牌号、热处理状态及塑性适用性，必要时采用弹塑性材料曲线。","大变形对传力与接触状态的影响。","实际连杆、电机传动、安装端柔度与预紧接触。","允许位移、要求的安全系数与正式设计验收依据。"];
  $("study-limitations").innerHTML=limits.map(t=>`<li>${html(t)}</li>`).join("");
  const sources=c01?[["ANSYS_Workbench_小腿静力学仿真任务规划 (2).md","2026-10-14：本轮两铜套加载、梁螺栓与配合面接触方案。"],["Robot_Material_Report_20261013_102312.xlsx","材料参数表第 2、12–14、17–18 行：七实体材料；铜套无屈服数据。"],["导出3.zip / 导出3.STEP","两加载铜套、铰耳、小腿与上部附件的几何核对。"],["本轮用户授权","8 孔全部按 D3 螺栓梁、E210 GPa、ν0.30、无预紧，先做参数试验。"]]:[["铝镁合金小腿仿真_DEMO_20261013.pptx","第 3–5、10–13 页：载荷、姿态、接口与电机参考。"],["Robot_Material_Report_20261013_102312.xlsx","材料参数表第 4、6、12–15、17–18、21 行：保留零件材料。"],["导出3.zip / 导出3.STEP","简化装配，36 个实际实体实例。"],["X1腿部总装0906.STEP","总装结构与省略部件核对。"]];
  $("source-rows").innerHTML=sources.map(([name,meaning])=>row(name,[meaning],false)).join("");
  $("source-scope-note").textContent=c01?"当前查看 C01 铜套加载试验：主载荷两个铜套各 4000 N，对照各 2000 N。S01 资料与下载可通过上方工况切换保留查看，两个模型的数值与验证不混用。":"页面数据包含 S01 已完成求解的结果、模型与核验摘要。4000 N 对照与 8000 N 主载荷属于同一 S01 直立工况；四个限位工况与其他姿态未包含在本次结果中。";
  $("node-download-note").textContent=data?.node_download_description||(c01?"网页合并分片并校验 SHA-256 后交给浏览器保存。请按各数组的节点 ID 对应位移、应力与坐标，不假设数组位置一一相同；物理实体、梁与连接节点的范围详见本轮下载清单。":"下载节点位移、等效应力与坐标数据。网页合并分片，校验 SHA-256 后交给浏览器保存。位移与应力按实体物理节点 ID 输出；坐标表另含 14 个广义节点记录。请按节点 ID 连接各字段，详见下载清单字段说明。");
  $("footer-study").textContent=`X1 / ${selectedStudy}`;$("footer-description").textContent=c01?"一阶四面体资源诊断 · 未网格收敛":"直立静力学首轮记录";
  document.title=`X1 · ${selectedStudy} ${c01?"铜套与梁螺栓试验":"直立静力学结果"}`;
  const stages=Array.isArray(data?.stages)?data.stages:[];
  $("study-stages").innerHTML=stages.map(s=>`<li><strong>${html(s.name||s.title)}</strong><span>${html(s.status||"待记录")}</span></li>`).join("");
  $("cloud-select").innerHTML=`<optgroup label="全模型与${c01?"铜套":"足底"}">${Object.entries(VIEWS).filter(([id])=>!id.startsWith("part-")).map(([id,v])=>`<option value="${html(id)}">${html(v[1])}</option>`).join("")}</optgroup><optgroup label="单零件等效应力">${PARTS.map(([key,label])=>`<option value="part-${key}">${html(label)}</option>`).join("")}</optgroup>`;
  $("cloud-select").value=selectedView;
}

function renderDownloads() {
  $("extra-downloads").innerHTML = (data?.downloads || []).filter(d=>safeURL(d.href||d.path)).map(d=>`<a href="${html(safeURL(d.href||d.path))}"${(d.href||d.path).startsWith("assets/")?' download':' target="_blank" rel="noopener noreferrer"'}>${html(d.label||d.name||"结果记录")} ↓</a>`).join("");
  document.querySelectorAll("[data-nodal-case]").forEach(button=>{
    const load=button.dataset.nodalCase, manifest=nodalManifest(load),key=`${selectedStudy}:${load}`,state=downloadStates.get(key);
    button.textContent=`下载 ${selectedStudy} · ${load} N 节点结果 (.npz) ↓`;
    button.disabled=!manifest||!validCase(casesOf()[load],load)||downloadingCases.has(key);
    $("download-status-"+load).textContent=state?.message||(manifest?"分片合并下载，完成后校验 SHA-256":"节点结果数据尚未提供");
    $("download-progress-"+load).hidden=!state;
    $("download-progress-"+load).value=state?.progress||0;
  });
}

function assetURL(value) { const url=safeURL(value);return url?.startsWith("assets/")?url:null; }
function nodalManifest(load) { return assetURL(data?.postprocess?.[load]?.downloads?.nodal_manifest); }
function bytesMB(bytes) { return (bytes/1e6).toFixed(1)+" MB"; }
async function downloadNodal(load) {
  const study=selectedStudy,key=`${study}:${load}`,url=nodalManifest(load),button=document.querySelector(`[data-nodal-case="${load}"]`),status=$("download-status-"+load),progress=$("download-progress-"+load);
  if(!url||downloadingCases.has(key))return;
  const update=(message,value)=>{downloadStates.set(key,{message,progress:value});if(selectedStudy===study){status.textContent=message;progress.value=value;progress.hidden=false;}};
  downloadingCases.add(key);button.disabled=true;update(`${study} · ${load} N · 正在读取下载清单…`,0);
  const chunks=[];
  try {
    const manifestResponse=await fetch(url,{cache:"no-cache"});if(!manifestResponse.ok)throw new Error("下载清单读取失败");
    const manifest=await manifestResponse.json();
    if(!Array.isArray(manifest.parts)||!manifest.parts.length||!finite(manifest.total_bytes)||manifest.total_bytes<=0||!/^[a-f0-9]{64}$/i.test(manifest.sha256||"")||typeof manifest.filename!=="string"||/[\\/]/.test(manifest.filename))throw new Error("下载清单字段不完整");
    const expectedTotal=manifest.parts.reduce((sum,p)=>sum+(finite(p.bytes)?p.bytes:0),0);
    if(expectedTotal!==manifest.total_bytes||manifest.parts.some(p=>!assetURL(p.src)||!finite(p.bytes)||p.bytes<=0))throw new Error("分片路径或长度记录不一致");
    let loaded=0;
    for(let index=0;index<manifest.parts.length;index++) {
      const part=manifest.parts[index],response=await fetch(assetURL(part.src));if(!response.ok)throw new Error(`第 ${index+1} 片读取失败 (${response.status})`);
      let partLoaded=0;
      if(response.body?.getReader) {
        const reader=response.body.getReader();
        while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);partLoaded+=value.byteLength;loaded+=value.byteLength;update(`${study} · ${load} N · 分片 ${index+1}/${manifest.parts.length} · ${bytesMB(loaded)} / ${bytesMB(manifest.total_bytes)}`,Math.min(100,loaded/manifest.total_bytes*100));}
      } else {const bytes=new Uint8Array(await response.arrayBuffer());chunks.push(bytes);partLoaded=bytes.byteLength;loaded+=partLoaded;update(`${study} · ${load} N · 分片 ${index+1}/${manifest.parts.length} · ${bytesMB(loaded)} / ${bytesMB(manifest.total_bytes)}`,loaded/manifest.total_bytes*100);}
      if(partLoaded!==part.bytes)throw new Error(`第 ${index+1} 片长度校验失败`);
    }
    if(loaded!==manifest.total_bytes)throw new Error("完整文件长度校验失败");
    update(`${study} · ${load} N · ${bytesMB(loaded)} 已读取，正在校验 SHA-256…`,100);
    if(!window.crypto?.subtle)throw new Error("当前浏览器不支持 SHA-256 校验，请使用 HTTPS 页面或更新浏览器");
    const blob=new Blob(chunks,{type:"application/octet-stream"}),buffer=await blob.arrayBuffer();
    const digest=await window.crypto.subtle.digest("SHA-256",buffer),hash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("");
    if(hash!==manifest.sha256.toLowerCase())throw new Error("完整文件 SHA-256 校验失败，未保存文件");
    const objectURL=URL.createObjectURL(blob),anchor=document.createElement("a");anchor.href=objectURL;anchor.download=manifest.filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),30000);
    update(`${study} · ${load} N · SHA-256 校验通过，${bytesMB(loaded)} 已交给浏览器保存。`,100);
  } catch(error) {update(`${study} · ${load} N · 下载未完成：${error.message}。可以重试。`,downloadStates.get(key)?.progress||0);} finally {chunks.length=0;downloadingCases.delete(key);if(selectedStudy===study)button.disabled=false;}
}

function selectView(value) {
  if(!VIEWS[value])return;
  selectedView=value;$("cloud-select").value=value;
  document.querySelectorAll("[data-view]").forEach(b=>{const active=b.dataset.view===value;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));});
  if(data)renderImage();
}
function selectCase(value) {
  selectedCase = value;
  document.querySelectorAll("[data-case]").forEach(button=>{const active=button.dataset.case===value;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
  renderResults();renderVerification();renderDownloads();
}

function selectStudy(value) {
  if(!["S01","C01"].includes(value))return;
  selectedStudy=value;data=studyData(value);PARTS=value==="C01"?C01_PARTS:S01_PARTS;PROBES=value==="C01"?C01_PROBES:S01_PROBES;VIEWS=viewsForStudy(value);
  if(!VIEWS[selectedView])selectedView="displacement";
  const cases=casesOf();
  if(!validCase(cases[selectedCase],selectedCase)&&validCase(cases["4000"],4000))selectedCase="4000";
  else if(!validCase(cases[selectedCase],selectedCase)&&validCase(cases["8000"],8000))selectedCase="8000";
  document.querySelectorAll("[data-study]").forEach(button=>{const active=button.dataset.study===value;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
  document.querySelectorAll("[data-case]").forEach(button=>{button.disabled=!validCase(cases[button.dataset.case],button.dataset.case);});
  const hasResults=validCase(cases["4000"],4000)||validCase(cases["8000"],8000);
  $("data-message").hidden=hasResults;$("data-message").textContent=`${value} 待求解：尚无通过 Done 与探针核对的结果。此处只显示试验输入，不引用其它工况数值。`;$("data-message").classList.toggle("error",!hasResults);
  renderStudyContext();selectCase(selectedCase);selectView(selectedView);
}

document.querySelectorAll("[data-case]").forEach(button=>button.addEventListener("click",()=>{if(data)selectCase(button.dataset.case);}));
document.querySelectorAll("[data-study]").forEach(button=>button.addEventListener("click",()=>{if(rootData)selectStudy(button.dataset.study);}));
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>selectView(button.dataset.view)));
$("cloud-select").addEventListener("change",event=>selectView(event.target.value));
$("part-rows").addEventListener("click",event=>{const button=event.target.closest("[data-part-view]");if(button){selectView(button.dataset.partView);document.querySelector(".viewer").scrollIntoView({behavior:"smooth",block:"start"});}});
document.querySelectorAll("[data-nodal-case]").forEach(button=>button.addEventListener("click",()=>downloadNodal(button.dataset.nodalCase)));
$("print-button").addEventListener("click",()=>window.print());
$("image-open").addEventListener("click",()=>{const source=$("cloud-image");if(source.hidden)return;$("dialog-image").src=source.src;$("dialog-image").alt=source.alt;$("dialog-caption").textContent=$("cloud-title").textContent+" · "+$("cloud-caption").textContent;$("image-dialog").showModal();});
$("dialog-close").addEventListener("click",()=>$("image-dialog").close());
$("image-dialog").addEventListener("click",event=>{if(event.target===$("image-dialog"))$("image-dialog").close();});

fetch("assets/data.json",{cache:"no-cache"}).then(response=>{if(!response.ok)throw new Error("结果数据尚未提供");return response.json();}).then(value=>{
  rootData=value;
  const c01Cases=casesOf(studyData("C01"));
  selectStudy(validCase(c01Cases["8000"],8000,"C01")?"C01":"S01");
}).catch(error=>{data=null;$("data-message").textContent=`结果暂不可显示：${error.message}。页面不会使用未完成求解或缓存数值。`;$("data-message").classList.add("error");$("image-open").disabled=true;});
