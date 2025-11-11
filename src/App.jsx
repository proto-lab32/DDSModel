'use client'

import React, { useState } from 'react'
import { Upload, BarChart3, Wind, CloudRain, Sun, Thermometer, Play } from 'lucide-react'

/**
 * NFL Totals Simulator – HYBRID
 * Engine: Gambletron core (PPD z-score matchup, pace-derived drives, zero-sum TOs)
 * Weather: Applied ONLY AFTER expected team points are computed (post‑hoc total adjustment)
 *
 * Key differences from other builds:
 * - Keeps Gambletron scoring pipeline/params intact
 * - Adds a weather module that nudges the FINAL MEANS (team points) by splitting a total delta 50/50
 * - Keeps correlation RHO fixed (0.20) to match original engine behavior
 */

export default function NFLTotalsHybrid() {
  // ===== League / Params (from Gambletron core) =====
  const params = {
    lg: {
      // Offensive averages
      PPD: 2.128221,
      PPD_sd: 0.450432,
      EPA: 0.021441,
      EPA_sd: 0.079638,
      SR: 0.470531,
      SR_sd: 0.032318,
      Xpl: 0.068034,
      Xpl_sd: 0.011744,
      RZ: 0.480041,
      RZ_sd: 0.087699,
      ThreeOut: 0.073256,
      ThreeOut_sd: 0.027942,
      Pen: 0.631683,
      Pen_sd: 0.094566,
      Drives: 10.736892,

      // Defensive averages
      PPD_def: 2.123475,
      PPD_def_sd: 0.357726,
      EPA_def: 0.020530,
      SR_def: 0.470253,
      Xpl_def: 0.067706,
      RZ_def: 0.481841,
      ThreeOut_def: 0.072447,
      Pen_def: 0.634701,
      Drives_def: 10.728733,

      // Pace factors
      SecSnap: 21.639937,
      SecSnap_sd: 1.015126,
      PassRate: 0.544806,
      PassRate_sd: 0.047359,
      NoHuddle: 0.084066,
      NoHuddle_sd: 0.093386,
      PlaysPerDrive: 7.559738,

      // Other
      TO_pct_league: 0.106391,
      TO_pct_sd: 0.034313,
      TO_points: 2.4,
      StartingFP: 30.311875,
      StartingFP_sd: 1.521178,
    },
    weights: {
      PPD: 0.20,
      EPA: 0.35,
      SR: 0.25,
      Xpl: 0.05,
      RZ: 0.05,
      ThreeOut_eff: 0.35,
      Pen: 0.25,
      Pen_def: 0.15,
      DVOA_off: 0.35,
      DVOA_def: 0.35,
      FP: 0.15,
    },
    DVOA_MULT: 1.2,
    DVOA_CAP: 0.10,
    NET_ADV_SHRINK: 0.60,
    TO_DELTA_SHRINK: 0.75,
    EV_SD_Total: 12.7,
  }

  // Correlation fixed to preserve core engine
  const RHO = 0.20

  // ===== Weather (post‑hoc) =====
  const weatherParams = {
    dome_bonus_total: 2.5, // add to TOTAL only; split 50/50 to teams
    wind_threshold_mph: 12,
    wind_per_mph_above_threshold_total: -0.07, // total impact per mph above threshold
    extreme_cold_threshold_f: 20,
    extreme_cold_total_penalty: -1.0,
    precip_total_adjustments: {
      none: 0,
      light_rain: -0.8,
      heavy_rain: -1.6,
      snow: -2.0,
    },
  }

  // ===== UI State =====
  const [teamDB, setTeamDB] = useState({})
  const [teamList, setTeamList] = useState([])
  const [homeTeam, setHomeTeam] = useState('')
  const [awayTeam, setAwayTeam] = useState('')
  const [numSimulations, setNumSimulations] = useState(10000)
  const [marketTotal, setMarketTotal] = useState('')
  const [homeTeamTotal, setHomeTeamTotal] = useState('')
  const [awayTeamTotal, setAwayTeamTotal] = useState('')
  const [uploadStatus, setUploadStatus] = useState('')
  const [simulationResults, setSimulationResults] = useState(null)
  const [isSimulating, setIsSimulating] = useState(false)

  const [weather, setWeather] = useState({
    isDome: false,
    windMPH: 0,
    temperatureF: 68,
    precipitation: 'none', // none | light_rain | heavy_rain | snow
  })

  // ===== CSV handling (robust percent/number coercion + aliases) =====
  const parsePercentStrict = (v) => {
    if (v == null) return null
    if (typeof v === 'number') { if (v > 1 && v <= 100) return v / 100; return Number.isFinite(v) ? v : null }
    const s = String(v).trim()
    const neg = /^\(.*\)$/.test(s)
    const hasPct = s.includes('%')
    const num = parseFloat(s.replace(/[()%\s]/g, ''))
    if (!Number.isFinite(num)) return null
    const val = hasPct ? num / 100 : (num > 1 && num <= 100 ? num / 100 : num)
    return neg ? -val : val
  }
  const parseNumberStrict = (v) => {
    if (v == null) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    const s = String(v).trim().replace(/,/g, '')
    const n = +s
    return Number.isFinite(n) ? n : null
  }

  const SCHEMA = {
    percent: new Set([
      'Off Success Rate','Off Explosive Rate','Off Red-Zone TD%','Off 3-Out %',
      'Def Success Rate','Def Explosive Rate','Def Red Zone TD %','DEF 3-out %','Def 3-Out %',
      'No-Huddle %','Neutral Early-Down Pass %','Off DVOA','DEF DVOA','Def DVOA','Off Turnover %','Def Turnover %',
      // verbose
      'Offensive Success Rate','Offensive Explosive Play Rate','Offensive Red Zone TD Rate','Off 3-out Rate',
      'Defensive Success Rate','Defensive Explosive Play Rate','Defensive Red Zone TD Rate','Defensive 3-out Rate',
      'Offensive No Huddle Rate','Offensive Early Down Pass Rate','Offensive DVOA','Defensive DVOA','Offensive TO%','Defensive TO%',
    ]),
    float: new Set([
      'OFF PPD','Off PPD','OFF EPA','Off EPA/play','DEF PPD Allowed','Def PPD Allowed','Def EPA/play allowed',
      'Off Penalties per Drive','DEF Penalties per Drive','Off Drives/G','Def Drives/G','Off Sec/Snap','Off Avg Starting FP',
      'Off Plays/Drive','Def Plays/Drive Allowed',
      // aliases
      'Offensive Pts/Drive','Offensive EPA/Play','Defensive Pts/Drive','Defensive EPA/Play','Offensive Penalties/Drive','Defensive Penalties/Drive',
      'Offensive Drives/Game','Defensive Drives/Game','Offensive Seconds/Snap','Offensive Average Starting Field Position','Offensive Plays/Drive','Defensive Plays/Drive',
    ]),
    string: new Set(['Team','team'])
  }

  const COLUMN_ALIASES = {
    'Offensive Drives/Game': 'Off Drives/G',
    'Offensive Pts/Drive': 'Off PPD',
    'Offensive EPA/Play': 'Off EPA/play',
    'Offensive Success Rate': 'Off Success Rate',
    'Offensive Explosive Play Rate': 'Off Explosive Rate',
    'Offensive Plays/Drive': 'Off Plays/Drive',
    'Offensive Red Zone TD Rate': 'Off Red-Zone TD%',
    'Offensive TO%': 'Off Turnover %',
    'Offensive Penalties/Drive': 'Off Penalties per Drive',
    'Offensive Seconds/Snap': 'Off Sec/Snap',
    'Offensive Average Starting Field Position': 'Off Avg Starting FP',
    'Offensive No Huddle Rate': 'No-Huddle %',
    'Offensive Early Down Pass Rate': 'Neutral Early-Down Pass %',
    'Off 3-out Rate': 'Off 3-Out %',
    'Defensive Drives/Game': 'Def Drives/G',
    'Defensive Pts/Drive': 'Def PPD Allowed',
    'Defensive EPA/Play': 'Def EPA/play allowed',
    'Defensive Success Rate': 'Def Success Rate',
    'Defensive Explosive Play Rate': 'Def Explosive Rate',
    'Defensive Plays/Drive': 'Def Plays/Drive Allowed',
    'Defensive Red Zone TD Rate': 'Def Red Zone TD %',
    'Defensive 3-out Rate': 'Def 3-Out %',
    'Defensive TO%': 'Def Turnover %',
    'Defensive Penalties/Drive': 'DEF Penalties per Drive',
    'Defensive DVOA': 'Def DVOA',
  }

  const coerceRow = (row) => {
    const out = {}
    for (const [k, v] of Object.entries(row)) {
      const columnName = COLUMN_ALIASES[k] || k
      if (SCHEMA.percent.has(k) || SCHEMA.percent.has(columnName)) out[columnName] = parsePercentStrict(v)
      else if (SCHEMA.float.has(k) || SCHEMA.float.has(columnName)) out[columnName] = parseNumberStrict(v)
      else if (SCHEMA.string.has(k) || SCHEMA.string.has(columnName)) out[columnName] = v
      else out[columnName] = v
    }
    return out
  }

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadStatus('Reading file…')
    try {
      const text = await file.text()
      const Papa = await import('papaparse')
      const parsed = Papa.parse(text, { header: true, dynamicTyping: false, skipEmptyLines: true })
      if (!parsed.data || parsed.data.length === 0) { setUploadStatus('❌ Error: empty CSV'); return }

      const nextDB = {}
      const names = []
      parsed.data.forEach((row) => {
        const coerced = coerceRow(row)
        const name = String(coerced['Team'] || coerced['team'] || '').trim()
        if (!name) return
        names.push(name)
        nextDB[name] = coerced
      })
      if (names.length === 0) { setUploadStatus("❌ Error: No teams found. Make sure CSV has 'Team' column."); return }

      setTeamDB(nextDB)
      setTeamList(names.sort())
      setUploadStatus(`✅ Loaded ${names.length} teams`)
      setSimulationResults(null)
    } catch (e) {
      setUploadStatus(`❌ Error: ${e?.message || e}`)
    }
  }

  // ===== Helpers =====
  const zScore = (val, mean, sd) => { const s = (!sd || sd === 0) ? 1e-9 : sd; const v = (val == null || mean == null) ? mean : val; return (v - mean) / s }

  const projectTeamFromDB = (teamName) => {
    const r = teamDB[teamName] || {}
    const lg = params.lg
    return {
      name: teamName,
      // Offense
      off_ppd: r['Off PPD'] ?? lg.PPD,
      off_epa: r['Off EPA/play'] ?? lg.EPA,
      off_sr: r['Off Success Rate'] ?? lg.SR,
      off_xpl: r['Off Explosive Rate'] ?? lg.Xpl,
      off_rz: r['Off Red-Zone TD%'] ?? lg.RZ,
      off_3out: r['Off 3-Out %'] ?? lg.ThreeOut,
      off_penalties: r['Off Penalties per Drive'] ?? lg.Pen,
      off_dvoa: r['Off DVOA'] ?? 0,
      off_drives: r['Off Drives/G'] ?? lg.Drives,
      // Defense
      def_ppd_allowed: r['Def PPD Allowed'] ?? params.lg.PPD_def,
      def_epa_allowed: r['Def EPA/play allowed'] ?? params.lg.EPA_def,
      def_sr: r['Def Success Rate'] ?? params.lg.SR_def,
      def_xpl: r['Def Explosive Rate'] ?? params.lg.Xpl_def,
      def_penalties: r['DEF Penalties per Drive'] ?? params.lg.Pen_def,
      def_rz: r['Def Red Zone TD %'] ?? params.lg.RZ_def,
      def_3out: r['Def 3-Out %'] ?? r['DEF 3-out %'] ?? params.lg.ThreeOut_def,
      def_dvoa: r['Def DVOA'] ?? 0,
      def_drives: r['Def Drives/G'] ?? params.lg.Drives_def,
      def_to_pct: r['Def Turnover %'] ?? params.lg.TO_pct_league,
      // Misc
      off_to_pct: r['Off Turnover %'] ?? params.lg.TO_pct_league,
      off_fp: r['Off Avg Starting FP'] ?? params.lg.StartingFP,
      no_huddle: r['No-Huddle %'] ?? params.lg.NoHuddle,
      ed_pass: r['Neutral Early-Down Pass %'] ?? params.lg.PassRate,
      off_plays: r['Off Plays/Drive'] ?? params.lg.PlaysPerDrive,
      def_plays: r['Def Plays/Drive Allowed'] ?? params.lg.PlaysPerDrive,
      sec_snap: r['Off Sec/Snap'] ?? params.lg.SecSnap,
    }
  }

  const calcPaceAdjustment = (secPerSnap, passRate, noHuddleRate, lg) => {
    const secSnapZ = (lg.SecSnap - secPerSnap) / lg.SecSnap_sd
    const passZ = (passRate - lg.PassRate) / lg.PassRate_sd
    const noHuddleZ = (noHuddleRate - lg.NoHuddle) / lg.NoHuddle_sd
    const paceZ = 0.6 * secSnapZ + 0.25 * passZ + 0.15 * noHuddleZ
    return 1 + 0.05 * paceZ
  }

  // Core Gambletron estimate (no weather here!)
  const estimateScore = (team, oppDefense) => {
    const lg = params.lg
    const w = params.weights

    const off_ppd = team.off_ppd ?? lg.PPD
    const def_ppda = oppDefense.def_ppd_allowed ?? lg.PPD_def

    const z_off = (off_ppd - lg.PPD) / lg.PPD_sd
    const z_def = (def_ppda - lg.PPD_def) / lg.PPD_def_sd

    const effZ = 0.60 * z_off + 0.40 * (-z_def)

    const offD = Math.max(-params.DVOA_CAP, Math.min(params.DVOA_CAP, team.off_dvoa || 0))
    const defD = Math.max(-params.DVOA_CAP, Math.min(params.DVOA_CAP, oppDefense.def_dvoa || 0))
    const dvoa_raw = (offD * w.DVOA_off) + (defD * w.DVOA_def)
    const dvoa_adj = params.DVOA_MULT * dvoa_raw

    const fp_z = zScore(team.off_fp, lg.StartingFP, lg.StartingFP_sd)
    const fp_adj = fp_z * w.FP

    const net_adv = Math.max(-2.0, Math.min(2.0, params.NET_ADV_SHRINK * (effZ + dvoa_adj + fp_adj)))
    let ppd = lg.PPD + net_adv * lg.PPD_sd
    ppd = Math.max(0.8, Math.min(3.2, ppd))

    // Pace → drives (kept from Gambletron)
    const homePaceAdj = calcPaceAdjustment(team.sec_snap ?? lg.SecSnap, team.ed_pass ?? lg.PassRate, team.no_huddle ?? lg.NoHuddle, lg)
    const awayPaceAdj = calcPaceAdjustment(oppDefense.sec_snap ?? lg.SecSnap, oppDefense.ed_pass ?? lg.PassRate, oppDefense.no_huddle ?? lg.NoHuddle, lg)
    const gamePace = (homePaceAdj + awayPaceAdj) / 2

    const drivesRaw = lg.Drives * gamePace
    const drivesShrunk = 0.6 * drivesRaw + 0.4 * lg.Drives
    const drives = Math.max(9.0, Math.min(11.5, drivesShrunk))

    return { ppd, drives, team, oppDefense }
  }

  // Zero‑sum TOs (kept from Gambletron)
  const calculateZeroSumTurnovers = (homeCalc, awayCalc) => {
    const lg = params.lg
    const clampRate = (x) => Math.max(0, Math.min(0.30, x))

    const giveHome = clampRate((homeCalc.team.off_to_pct + awayCalc.team.def_to_pct) / 2)
    const takeHome = clampRate((awayCalc.team.off_to_pct + homeCalc.team.def_to_pct) / 2)
    const deltaHome = (takeHome - giveHome) * params.TO_DELTA_SHRINK

    const giveAway = clampRate((awayCalc.team.off_to_pct + homeCalc.team.def_to_pct) / 2)
    const takeAway = clampRate((homeCalc.team.off_to_pct + awayCalc.team.def_to_pct) / 2)
    const deltaAway = (takeAway - giveAway) * params.TO_DELTA_SHRINK

    const avgDelta = (deltaHome - deltaAway) / 2
    const deltaHome0 = avgDelta

    const avgDrives = (homeCalc.drives + awayCalc.drives) / 2

    const to_points_home = Math.max(-3.0, Math.min(3.0, deltaHome0 * lg.TO_points * avgDrives))
    const to_points_away = -to_points_home

    return { to_points_home, to_points_away }
  }

  // Weather impact function (TOTAL only). Returns a TOTAL delta to be split evenly.
  const computeWeatherTotalDelta = () => {
    const w = weather
    const wp = weatherParams
    if (w.isDome) return wp.dome_bonus_total

    let total = 0
    if (w.windMPH > wp.wind_threshold_mph) {
      const over = w.windMPH - wp.wind_threshold_mph
      total += over * wp.wind_per_mph_above_threshold_total
    }
    if (w.temperatureF < wp.extreme_cold_threshold_f) total += wp.extreme_cold_total_penalty
    total += (wp.precip_total_adjustments[w.precipitation] || 0)
    return total
  }

  // ===== Simulation =====
  const runMonteCarloSimulation = () => {
    if (!homeTeam || !awayTeam) { alert('Please select both home and away teams'); return }
    setIsSimulating(true)
    setSimulationResults(null)

    setTimeout(() => {
      const homeData = projectTeamFromDB(homeTeam)
      const awayData = projectTeamFromDB(awayTeam)

      const homeCalc = estimateScore(homeData, awayData)
      const awayCalc = estimateScore(awayData, homeData)

      const { to_points_home, to_points_away } = calculateZeroSumTurnovers(homeCalc, awayCalc)

      // Base expected means (NO WEATHER yet)
      let homeMean = homeCalc.ppd * homeCalc.drives + to_points_home
      let awayMean = awayCalc.ppd * awayCalc.drives + to_points_away

      // === POST‑HOC WEATHER: adjust FINAL means symmetrically ===
      const totalDelta = computeWeatherTotalDelta() // can be +/-
      homeMean = Math.max(0, homeMean + totalDelta * 0.5)
      awayMean = Math.max(0, awayMean + totalDelta * 0.5)

      // Team-level SD from total SD and drives scaling (kept from Gambletron)
      const targetTotalsSD = params.EV_SD_Total
      const homeSD = (targetTotalsSD / Math.sqrt(2 * (1 + RHO))) * Math.sqrt(homeCalc.drives / params.lg.Drives)
      const awaySD = (targetTotalsSD / Math.sqrt(2 * (1 + RHO))) * Math.sqrt(awayCalc.drives / params.lg.Drives)

      const n = Number(numSimulations) || 10000
      const homeScores = new Array(n)
      const awayScores = new Array(n)
      const totals = new Array(n)
      const sqrt1mr2 = Math.sqrt(1 - RHO * RHO)

      for (let i = 0; i < n; i++) {
        const u1 = Math.random(), u2 = Math.random()
        const r = Math.sqrt(-2 * Math.log(u1))
        const theta = 2 * Math.PI * u2
        const z1 = r * Math.cos(theta)
        const z2i = r * Math.sin(theta)
        const z2c = RHO * z1 + sqrt1mr2 * z2i

        const h = Math.max(0, homeMean + z1 * homeSD)
        const a = Math.max(0, awayMean + z2c * awaySD)

        // Round to integer points like box score output
        homeScores[i] = Math.round(h)
        awayScores[i] = Math.round(a)
        totals[i] = homeScores[i] + awayScores[i]
      }

      const calcStats = (arr) => {
        const sorted = [...arr].sort((a, b) => a - b)
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length
        const median = sorted[Math.floor(arr.length / 2)]
        const p10 = sorted[Math.floor(arr.length * 0.10)]
        const p90 = sorted[Math.floor(arr.length * 0.90)]
        return { mean, median, p10, p90 }
      }

      const homeStats = calcStats(homeScores)
      const awayStats = calcStats(awayScores)
      const totalStats = calcStats(totals)

      let overUnder = null
      if (marketTotal && !isNaN(parseFloat(marketTotal))) {
        const line = parseFloat(marketTotal)
        let over = 0, under = 0, push = 0
        totals.forEach(t => { if (t > line) over++; else if (t < line) under++; else push++ })
        overUnder = { line, overPct: (over / n) * 100, underPct: (under / n) * 100, pushPct: (push / n) * 100 }
      }

      let homeTeamOverUnder = null
      if (homeTeamTotal && !isNaN(parseFloat(homeTeamTotal))) {
        const line = parseFloat(homeTeamTotal)
        let over = 0, under = 0, push = 0
        homeScores.forEach(s => { if (s > line) over++; else if (s < line) under++; else push++ })
        homeTeamOverUnder = { line, overPct: (over / n) * 100, underPct: (under / n) * 100, pushPct: (push / n) * 100 }
      }

      let awayTeamOverUnder = null
      if (awayTeamTotal && !isNaN(parseFloat(awayTeamTotal))) {
        const line = parseFloat(awayTeamTotal)
        let over = 0, under = 0, push = 0
        awayScores.forEach(s => { if (s > line) over++; else if (s < line) under++; else push++ })
        awayTeamOverUnder = { line, overPct: (over / n) * 100, underPct: (under / n) * 100, pushPct: (push / n) * 100 }
      }

      setSimulationResults({
        homeTeam, awayTeam,
        weatherUsed: { ...weather, totalDelta },
        homeProjection: homeStats,
        awayProjection: awayStats,
        totalProjection: totalStats,
        overUnder, homeTeamOverUnder, awayTeamOverUnder,
        numSimulations: n,
      })
      setIsSimulating(false)
    }, 60)
  }

  // ===== UI =====
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center py-6">
          <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent">NFL Totals – Hybrid</h1>
          <p className="text-slate-300 mt-2 text-sm">Gambletron engine • Weather applied after scoring • Fixed ρ = 0.20</p>
        </div>

        {/* Upload */}
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-5">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Upload className="w-5 h-5"/> Upload Team CSV</h2>
          <input type="file" accept=".csv" onChange={handleFileUpload}
                 className="block w-full text-sm file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-amber-500 file:text-black hover:file:bg-amber-400 cursor-pointer"/>
          {uploadStatus && <p className="mt-2 text-sm text-amber-300">{uploadStatus}</p>}
        </div>

        {/* Controls */}
        {teamList.length > 0 && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-5">
              <h3 className="text-base font-semibold mb-4 flex items-center gap-2"><BarChart3 className="w-5 h-5"/> Simulation Params</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-300">Home Team</label>
                  <select value={homeTeam} onChange={(e)=>setHomeTeam(e.target.value)} className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2">
                    <option value="">Select Home</option>
                    {teamList.map(t=> <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300">Away Team</label>
                  <select value={awayTeam} onChange={(e)=>setAwayTeam(e.target.value)} className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2">
                    <option value="">Select Away</option>
                    {teamList.map(t=> <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300">Simulations</label>
                  <input type="number" min={2000} max={100000} step={1000} value={numSimulations}
                         onChange={(e)=>setNumSimulations(parseInt(e.target.value)||10000)}
                         className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"/>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-300">Game Total</label>
                    <input type="number" step="0.5" value={marketTotal} onChange={(e)=>setMarketTotal(e.target.value)}
                           className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2" placeholder="e.g. 47.5"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-300">Home Team Total</label>
                    <input type="number" step="0.5" value={homeTeamTotal} onChange={(e)=>setHomeTeamTotal(e.target.value)}
                           className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2" placeholder="e.g. 24.5"/>
                  </div>
                  <div>
                    <label className="text-xs text-slate-300">Away Team Total</label>
                    <input type="number" step="0.5" value={awayTeamTotal} onChange={(e)=>setAwayTeamTotal(e.target.value)}
                           className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2" placeholder="e.g. 21.0"/>
                  </div>
                </div>
                <button onClick={runMonteCarloSimulation} disabled={isSimulating}
                        className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold px-4 py-2 rounded mt-2">
                  <Play className="w-4 h-4"/> {isSimulating ? 'Running…' : 'Run Simulation'}
                </button>
              </div>
            </div>

            <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-5">
             <h3 className="text-base font-semibold mb-4 flex items-center gap-2"><Wind className="w-5 h-5"/> Weather (post-hoc)</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 col-span-2">
                  <input type="checkbox" checked={weather.isDome} onChange={(e)=>setWeather({...weather, isDome: e.target.checked})}/>
                  <span className="text-sm">Dome (adds +{weatherParams.dome_bonus_total} total points)</span>
                </label>
                <div>
                  <label className="text-xs text-slate-300 flex items-center gap-1"><Sun className="w-4 h-4"/> Wind (mph)</label>
                  <input type="number" min={0} max={40} value={weather.windMPH}
                         onChange={(e)=>setWeather({...weather, windMPH: parseFloat(e.target.value)||0})}
                         className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"/>
                </div>
                <div>
                  <label className="text-xs text-slate-300 flex items-center gap-1"><Thermometer className="w-4 h-4"/> Temp (°F)</label>
                  <input type="number" value={weather.temperatureF}
                         onChange={(e)=>setWeather({...weather, temperatureF: parseFloat(e.target.value)||68})}
                         className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"/>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-slate-300 flex items-center gap-1"><CloudRain className="w-4 h-4"/> Precipitation</label>
                  <select value={weather.precipitation} onChange={(e)=>setWeather({...weather, precipitation: e.target.value})}
                          className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-3 py-2">
                    <option value="none">None</option>
                    <option value="light_rain">Light Rain</option>
                    <option value="heavy_rain">Heavy Rain</option>
                    <option value="snow">Snow</option>
                  </select>
                </div>
                <div className="col-span-2 text-xs text-slate-400">
                  <p>Wind threshold: {weatherParams.wind_threshold_mph} mph (penalty above that: {weatherParams.wind_per_mph_above_threshold_total} per mph, total)</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {simulationResults && (
          <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-5">
            <h3 className="text-lg font-semibold mb-2">Results: {simulationResults.awayTeam} @ {simulationResults.homeTeam}</h3>
            <p className="text-sm text-slate-300 mb-4">Weather applied post‑hoc — total delta: <span className="font-semibold">{simulationResults.weatherUsed.totalDelta.toFixed(2)}</span> (split evenly)</p>

            <div className="grid md:grid-cols-3 gap-4 text-sm">
              <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
                <h4 className="font-semibold mb-2">Home Projection</h4>
                <div>Mean: {simulationResults.homeProjection.mean.toFixed(1)}</div>
                <div>Median: {simulationResults.homeProjection.median.toFixed(0)}</div>
                <div>P10–P90: {simulationResults.homeProjection.p10.toFixed(0)}–{simulationResults.homeProjection.p90.toFixed(0)}</div>
              </div>
              <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
                <h4 className="font-semibold mb-2">Away Projection</h4>
                <div>Mean: {simulationResults.awayProjection.mean.toFixed(1)}</div>
                <div>Median: {simulationResults.awayProjection.median.toFixed(0)}</div>
                <div>P10–P90: {simulationResults.awayProjection.p10.toFixed(0)}–{simulationResults.awayProjection.p90.toFixed(0)}</div>
              </div>
              <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
                <h4 className="font-semibold mb-2">Total Projection</h4>
                <div>Mean: {simulationResults.totalProjection.mean.toFixed(1)}</div>
                <div>Median: {simulationResults.totalProjection.median.toFixed(0)}</div>
                <div>P10–P90: {simulationResults.totalProjection.p10.toFixed(0)}–{simulationResults.totalProjection.p90.toFixed(0)}</div>
              </div>
            </div>

            {(simulationResults.overUnder) && (
              <div className="mt-4 text-sm">
                <h4 className="font-semibold mb-2">Over/Under @ {simulationResults.overUnder.line}</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900/50 rounded p-3 border border-slate-700">Over: {simulationResults.overUnder.overPct.toFixed(1)}%</div>
                  <div className="bg-slate-900/50 rounded p-3 border border-slate-700">Under: {simulationResults.overUnder.underPct.toFixed(1)}%</div>
                  <div className="bg-slate-900/50 rounded p-3 border border-slate-700">Push: {simulationResults.overUnder.pushPct.toFixed(1)}%</div>
                </div>
              </div>
            )}

            <div className="mt-6 text-xs text-slate-400">
              <p>Engine: Gambletron core (PPD z-scores, pace-derived drives, zero-sum turnovers, fixed ρ=0.20, EV_SD_Total={params.EV_SD_Total}). Weather applied after expected team points are computed.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
