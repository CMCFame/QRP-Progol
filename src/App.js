import React, { useState, useCallback } from 'react';
import { Target, Database, Brain, RefreshCw, CheckCircle2, BarChart3, FileDown, Bot, Upload, Settings, Zap, Gauge } from 'lucide-react';
import './App.css';

// ==================== CONFIGURACIÓN Y CONSTANTES ====================

const PROGOL_CONFIG = {
  DISTRIBUCION_HISTORICA: { L: 0.38, E: 0.29, V: 0.33 }, // 
  RANGOS_HISTORICOS: {
    L: [0.35, 0.41], // 
    E: [0.25, 0.33], // 
    V: [0.30, 0.36]  // 
  },
  EMPATES_PROMEDIO: 4.33, // 
  EMPATES_MIN: 4, // 
  EMPATES_MAX: 6, // 
  CONCENTRACION_MAX_GENERAL: 0.70, // 
  CONCENTRACION_MAX_INICIAL: 0.60, // 
  CALIBRACION: {
    k1_forma: 0.15, // 
    k2_lesiones: 0.10, // 
    k3_contexto: 0.20  // 
  },
  DRAW_PROPENSITY: {
    umbral_diferencia: 0.08, // 
    boost_empate: 0.06 // 
  }
};

// ==================== CLASES PRINCIPALES ====================

class MatchClassifier {
  constructor() {
    this.umbralAncla = 0.60; // 
    this.umbralDivisorMin = 0.40; // 
    this.umbralDivisorMax = 0.60; // 
    this.umbralEmpate = 0.30;
  }

  classifyMatches(partidos) {
    return partidos.map((partido, i) => {
      const partidoCalibrado = this.aplicarCalibracionBayesiana(partido); // 
      const clasificacion = this.clasificarPartido(partidoCalibrado); // 
      
      return {
        id: i,
        local: partido.local,
        visitante: partido.visitante,
        ...partidoCalibrado,
        clasificacion,
        resultadoSugerido: this.getResultadoSugerido(partidoCalibrado),
        confianza: this.calcularConfianza(partidoCalibrado)
      };
    });
  }

  aplicarCalibracionBayesiana(partido) { // 
    const { k1_forma, k2_lesiones, k3_contexto } = PROGOL_CONFIG.CALIBRACION;
    
    const deltaForma = partido.forma_diferencia || 0;
    const lesionesImpact = partido.lesiones_impact || 0;
    const contexto = partido.es_final ? 1.0 : 0.0;
    
    const factorAjuste = 1 + k1_forma * deltaForma + k2_lesiones * lesionesImpact + k3_contexto * contexto; // 
    
    let probLocal = partido.prob_local * factorAjuste;
    let probEmpate = partido.prob_empate;
    let probVisitante = partido.prob_visitante / Math.max(factorAjuste, 0.1);
    
    // Aplicar Draw-Propensity Rule 
    if (Math.abs(probLocal - probVisitante) < PROGOL_CONFIG.DRAW_PROPENSITY.umbral_diferencia &&
        probEmpate > Math.max(probLocal, probVisitante)) {
      probEmpate = Math.min(probEmpate + PROGOL_CONFIG.DRAW_PROPENSITY.boost_empate, 0.95);
    }
    
    // Renormalizar
    const total = probLocal + probEmpate + probVisitante;
    
    return {
      prob_local: probLocal / total,
      prob_empate: probEmpate / total,
      prob_visitante: probVisitante / total
    };
  }

  clasificarPartido(partido) { // 
    const probs = [partido.prob_local, partido.prob_empate, partido.prob_visitante];
    const maxProb = Math.max(...probs);
    
    if (maxProb > this.umbralAncla) return 'Ancla';
    if (partido.prob_empate > this.umbralEmpate && 
        partido.prob_empate >= Math.max(partido.prob_local, partido.prob_visitante)) {
      return 'TendenciaEmpate';
    }
    if (maxProb >= this.umbralDivisorMin && maxProb < this.umbralDivisorMax) return 'Divisor';
    return 'Neutro';
  }

  getResultadoSugerido(partido) {
    const probs = {
      L: partido.prob_local,
      E: partido.prob_empate,
      V: partido.prob_visitante
    };
    return Object.keys(probs).reduce((a, b) => probs[a] > probs[b] ? a : b);
  }

  calcularConfianza(partido) {
    const probs = [partido.prob_local, partido.prob_empate, partido.prob_visitante];
    probs.sort((a, b) => b - a);
    return probs[0] - probs[1];
  }
}

class PortfolioGenerator {
  constructor(seed = 42, config = {}) {
    this.seed = seed;
    this.config = {
      iteracionesOptimizador: 5000,
      temperaturaInicial: 0.80,
      tasaEnfriamiento: 0.995,
      ...config
    };
  }

  generateCoreQuinielas(partidosClasificados) { // 
    const coreQuinielas = [];
    
    for (let i = 0; i < 4; i++) {
      let quiniela = this.crearQuinielaBase(partidosClasificados);
      
      if (i > 0) {
        quiniela = this.aplicarVariacion(quiniela, partidosClasificados, i);
      }
      
      quiniela = this.ajustarEmpates(quiniela, partidosClasificados);
      
      const quinielaObj = {
        id: `Core-${i + 1}`,
        tipo: 'Core',
        resultados: quiniela,
        empates: quiniela.filter(r => r === 'E').length,
        prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
        distribucion: this.calcularDistribucion(quiniela)
      };
      
      coreQuinielas.push(quinielaObj);
    }
    
    return coreQuinielas;
  }

  crearQuinielaBase(partidosClasificados) {
    const quiniela = [];
    
    for (const partido of partidosClasificados) {
      let resultado;
      
      if (partido.clasificacion === 'Ancla') { // 
        resultado = partido.resultadoSugerido;
      } else if (partido.clasificacion === 'TendenciaEmpate') { // 
        resultado = 'E';
      } else {
        resultado = partido.resultadoSugerido;
      }
      quiniela.push(resultado);
    }
    
    return this.ajustarEmpates(quiniela, partidosClasificados);
  }

  generateSatelliteQuinielas(partidosClasificados, quinielasCore, numSatelites) { // 
    const satelites = [];
    const numPares = Math.floor(numSatelites / 2);
    
    const partidosDivisor = partidosClasificados
      .map((p, i) => ({ ...p, index: i }))
      .filter(p => p.clasificacion === 'Divisor'); // 
    
    for (let par = 0; par < numPares; par++) {
      const [satA, satB] = this.crearParSatelites( // 
        partidosClasificados,
        partidosDivisor,
        par
      );
      satelites.push(satA, satB);
    }
    
    if (numSatelites % 2 === 1) {
      const satExtra = this.crearSateliteIndividual(partidosClasificados, satelites.length);
      satelites.push(satExtra);
    }
    
    return satelites;
  }

  crearParSatelites(partidosClasificados, partidosDivisor, parId) {
    const partidoPrincipal = partidosDivisor.length > 0 ? partidosDivisor[parId % partidosDivisor.length].index : -1;
    
    let quinielaBase = this.crearQuinielaBase(partidosClasificados);

    const quinielaA = [...quinielaBase];
    const quinielaB = [...quinielaBase];
    
    if (partidoPrincipal !== -1) {
      const partido = partidosClasificados[partidoPrincipal];
      quinielaA[partidoPrincipal] = partido.resultadoSugerido;
      quinielaB[partidoPrincipal] = this.getResultadoAlternativo(partido);
    }
    
    const satA = {
      id: `Sat-${parId * 2 + 1}A`,
      tipo: 'Satelite', 
      resultados: this.ajustarEmpates(quinielaA, partidosClasificados),
      par_id: parId
    };
    
    const satB = {
      id: `Sat-${parId * 2 + 1}B`,
      tipo: 'Satelite', 
      resultados: this.ajustarEmpates(quinielaB, partidosClasificados),
      par_id: parId
    };
    
    [satA, satB].forEach(sat => {
      sat.empates = sat.resultados.filter(r => r === 'E').length;
      sat.prob_11_plus = this.calcularProb11Plus(sat.resultados, partidosClasificados);
      sat.distribucion = this.calcularDistribucion(sat.resultados);
    });
    
    return [satA, satB];
  }

  crearSateliteIndividual(partidosClasificados, sateliteId) {
    let quiniela = this.crearQuinielaBase(partidosClasificados);
    
    for (let i = 0; i < 2; i++) { // Change 2 non-anchor matches for variety
        const candidatos = partidosClasificados
            .map((p, idx) => ({...p, index: idx}))
            .filter(p => p.clasificacion !== 'Ancla' && quiniela[p.index] !== this.getResultadoAlternativo(p));
        
        if (candidatos.length > 0) {
            const idxToChange = candidatos[Math.floor(Math.random() * candidatos.length)].index;
            quiniela[idxToChange] = this.getResultadoAlternativo(partidosClasificados[idxToChange]);
        }
    }
    
    quiniela = this.ajustarEmpates(quiniela, partidosClasificados);
    
    return {
      id: `Sat-${sateliteId + 1}`,
      tipo: 'Satelite',
      resultados: quiniela,
      empates: quiniela.filter(r => r === 'E').length,
      prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
      distribucion: this.calcularDistribucion(quiniela),
      par_id: null
    };
  }

  getResultadoAlternativo(partido) {
    const probs = [
      { resultado: 'L', prob: partido.prob_local },
      { resultado: 'E', prob: partido.prob_empate },
      { resultado: 'V', prob: partido.prob_visitante }
    ];
    
    probs.sort((a, b) => b.prob - a.prob);
    return probs[1].resultado;
  }

  ajustarEmpates(quiniela, partidosClasificados) {
    let quinielaAjustada = [...quiniela];
    let empatesActuales = quinielaAjustada.filter(r => r === 'E').length;
    
    const candidatosA_E = partidosClasificados
        .map((p, i) => ({...p, index: i, prob_empate: p.prob_empate}))
        .filter((p, i) => quinielaAjustada[i] !== 'E')
        .sort((a,b) => b.prob_empate - a.prob_empate);

    while (empatesActuales < PROGOL_CONFIG.EMPATES_MIN && candidatosA_E.length > 0) {
        const candidato = candidatosA_E.shift();
        quinielaAjustada[candidato.index] = 'E';
        empatesActuales++;
    }

    const candidatosDe_E = partidosClasificados
        .map((p, i) => ({...p, index: i, prob_empate: p.prob_empate}))
        .filter((p, i) => quinielaAjustada[i] === 'E')
        .sort((a,b) => a.prob_empate - b.prob_empate);

    while (empatesActuales > PROGOL_CONFIG.EMPATES_MAX && candidatosDe_E.length > 0) {
        const candidato = candidatosDe_E.shift();
        quinielaAjustada[candidato.index] = this.getResultadoSugerido(candidato);
        empatesActuales--;
    }
    
    return quinielaAjustada;
  }

  aplicarVariacion(quiniela, partidosClasificados, variacion) {
    const quinielaVariada = [...quiniela];
    const candidatos = [];
    
    for (let i = 0; i < partidosClasificados.length; i++) {
      if (partidosClasificados[i].clasificacion !== 'Ancla') {
        candidatos.push(i);
      }
    }
    
    const numCambios = Math.min(1 + variacion, candidatos.length);
    const indicesCambio = this.shuffleArray(candidatos).slice(0, numCambios);
    
    for (const idx of indicesCambio) {
      quinielaVariada[idx] = this.getResultadoAlternativo(partidosClasificados[idx]);
    }
    
    return quinielaVariada;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ==================== MEJORA DE RENDIMIENTO ====================
  // Se reemplaza la simulación Monte Carlo por un cálculo de Programación Dinámica.
  // Es miles de veces más rápido y evita que el navegador se bloquee,
  // manteniendo la precisión del cálculo. Esta alternativa está sugerida
  // en la sección 4.3 de la metodología.
  calcularProb11Plus(quiniela, partidosClasificados) {
    const probsAcierto = quiniela.map((resultado, i) => {
      const partido = partidosClasificados[i];
      if (resultado === 'L') return partido.prob_local;
      if (resultado === 'E') return partido.prob_empate;
      return partido.prob_visitante;
    });

    const n = probsAcierto.length;
    let dp = new Array(n + 1).fill(0.0);
    dp[0] = 1.0;

    for (const p of probsAcierto) {
        for (let j = n; j >= 1; j--) {
            dp[j] = dp[j - 1] * p + dp[j] * (1 - p);
        }
        dp[0] = dp[0] * (1 - p);
    }
    
    let prob11Plus = 0;
    for (let k = 11; k <= n; k++) {
        prob11Plus += dp[k];
    }
    
    return prob11Plus;
  }

  calcularDistribucion(quiniela) {
    const total = quiniela.length;
    return {
      L: quiniela.filter(r => r === 'L').length / total,
      E: quiniela.filter(r => r === 'E').length / total,
      V: quiniela.filter(r => r === 'V').length / total
    };
  }
  
  optimizePortfolioGRASPAnnealing(quinielasIniciales, partidosClasificados, progressCallback) {
    const validator = new PortfolioValidator();
    const config = this.config;

    // --- FASE 1: GRASP (Construcción) ---
    progressCallback({ phase: 'GRASP', message: 'Building candidate pool...', percentage: 0 });

    const NUM_CANDIDATES = 500;
    let candidatePool = [];

    for (let i = 0; i < NUM_CANDIDATES; i++) {
        let quiniela = this.crearQuinielaBase(partidosClasificados);
        quiniela = this.aplicarVariacion(quiniela, partidosClasificados, Math.floor(Math.random() * 6));
        
        const quinielaObj = {
            id: `Cand-${i}`,
            tipo: 'Satelite',
            resultados: quiniela,
            empates: quiniela.filter(r => r === 'E').length,
            prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
            distribucion: this.calcularDistribucion(quiniela)
        };
        candidatePool.push(quinielaObj);
    }
    
    let constructedPortfolio = [...quinielasIniciales];
    const ALPHA = 0.25; 

    while (constructedPortfolio.length < config.numQuinielas && candidatePool.length > 0) {
        candidatePool.forEach(cand => {
            const tempPortfolio = [...constructedPortfolio, cand];
            cand.marginalGain = this.evaluarPortafolio(tempPortfolio) - this.evaluarPortafolio(constructedPortfolio);
        });

        candidatePool.sort((a, b) => b.marginalGain - a.marginalGain);

        const topN = Math.max(1, Math.floor(candidatePool.length * ALPHA));
        const selectedIndex = Math.floor(Math.random() * topN);
        const bestCandidate = candidatePool.splice(selectedIndex, 1)[0];
        
        bestCandidate.id = `Sat-${constructedPortfolio.length}`;
        constructedPortfolio.push(bestCandidate);

        const progress = 50 + (constructedPortfolio.length / config.numQuinielas) * 50;
        progressCallback({ phase: 'GRASP', message: 'Constructing portfolio...', percentage: progress });
    }
    
    // --- FASE 2: Simulated Annealing (Refinamiento) ---
    let mejorPortafolio = constructedPortfolio;
    let mejorScore = this.evaluarPortafolio(mejorPortafolio);
    let temperatura = config.temperaturaInicial;

    for (let iter = 0; iter < config.iteracionesOptimizador; iter++) {
        const vecinoPortafolio = this.generarVecino(mejorPortafolio, partidosClasificados);
        
        const validationResult = validator.validatePortfolio(vecinoPortafolio);
        if (!validationResult.es_valido) {
            temperatura *= config.tasaEnfriamiento;
            continue;
        }

        const scoreVecino = this.evaluarPortafolio(vecinoPortafolio);
        const delta = scoreVecino - mejorScore;
        
        if (delta > 0 || Math.random() < Math.exp(delta / temperatura)) { // 
            mejorPortafolio = vecinoPortafolio;
            mejorScore = scoreVecino;
        }
        
        temperatura *= config.tasaEnfriamiento;
        
        if (progressCallback && iter % 100 === 0) {
            progressCallback({
                phase: 'Annealing',
                message: 'Refining portfolio...',
                iteracion: iter,
                score: mejorScore,
                porcentaje: (iter / config.iteracionesOptimizador) * 100
            });
        }
    }
    
    return mejorPortafolio;
  }

  evaluarPortafolio(quinielas) {
    if (!quinielas || quinielas.length === 0) return 0;
    
    const probs11Plus = quinielas.map(q => q.prob_11_plus || 0);
    const probPortafolio = 1 - probs11Plus.reduce((acc, prob) => acc * (1 - prob), 1); // 
    
    return probPortafolio;
  }

  generarVecino(portafolio, partidosClasificados) {
    const nuevoPortafolio = portafolio.map(q => ({ ...q, resultados: [...q.resultados] }));
    
    if (nuevoPortafolio.length === 0) return [];

    const quinielaIdx = Math.floor(Math.random() * nuevoPortafolio.length);
    const quinielaAModificar = nuevoPortafolio[quinielaIdx];
    
    // No modificar quinielas Core
    if (quinielaAModificar.tipo === 'Core') {
        return nuevoPortafolio;
    }

    const partidosNoAnclaIdx = partidosClasificados
      .map((p, i) => i)
      .filter(i => partidosClasificados[i].clasificacion !== 'Ancla');
    
    if (partidosNoAnclaIdx.length > 0) {
      const idx = partidosNoAnclaIdx[Math.floor(Math.random() * partidosNoAnclaIdx.length)];
      
      const opciones = ['L', 'E', 'V'];
      const resultadoActual = quinielaAModificar.resultados[idx];
      const alternativo = opciones.filter(o => o !== resultadoActual)[Math.floor(Math.random() * 2)];
      
      quinielaAModificar.resultados[idx] = alternativo;
      
      quinielaAModificar.resultados = this.ajustarEmpates(quinielaAModificar.resultados, partidosClasificados);
      quinielaAModificar.empates = quinielaAModificar.resultados.filter(r => r === 'E').length;
      quinielaAModificar.prob_11_plus = this.calcularProb11Plus(quinielaAModificar.resultados, partidosClasificados);
      quinielaAModificar.distribucion = this.calcularDistribucion(quinielaAModificar.resultados);
    }
    
    return nuevoPortafolio;
  }
}

class PortfolioValidator {
  validatePortfolio(quinielas) { // 
    const validacion = {
      es_valido: true,
      errores: [],
      metricas: {}
    };

    if (!quinielas || quinielas.length === 0) {
      validacion.es_valido = false;
      validacion.errores.push("El portafolio está vacío.");
      return validacion;
    }

    this.validarEmpatesIndividuales(quinielas, validacion);
    this.validarDistribucionGlobal(quinielas, validacion);
    this.validarConcentracion(quinielas, validacion);
    this.calcularMetricas(quinielas, validacion);

    if (validacion.errores.length > 0) {
      validacion.es_valido = false;
    }

    return validacion;
  }

  validarDistribucionGlobal(quinielas, validacion) {
    const totalPredicciones = quinielas.length * 14;
    const conteos = { L: 0, E: 0, V: 0 };

    quinielas.forEach(quiniela => {
      quiniela.resultados.forEach(resultado => conteos[resultado]++);
    });

    const distribucionGlobal = {
      L: conteos.L / totalPredicciones,
      E: conteos.E / totalPredicciones,
      V: conteos.V / totalPredicciones
    };

    validacion.metricas.distribucion_global = distribucionGlobal;

    Object.entries(distribucionGlobal).forEach(([resultado, proporcion]) => {
      const [minVal, maxVal] = PROGOL_CONFIG.RANGOS_HISTORICOS[resultado]; // 

      if (proporcion < minVal || proporcion > maxVal) {
        validacion.errores.push(
          `Distribución global de '${resultado}' (${(proporcion * 100).toFixed(1)}%) fuera del rango.`
        );
      }
    });
  }

  validarEmpatesIndividuales(quinielas, validacion) {
    quinielas.forEach((quiniela, i) => {
      const empates = quiniela.resultados.filter(r => r === 'E').length;

      if (empates < PROGOL_CONFIG.EMPATES_MIN || empates > PROGOL_CONFIG.EMPATES_MAX) { // 
        validacion.errores.push(`Quiniela ${quiniela.id || i+1} tiene ${empates} empates (fuera del rango ${PROGOL_CONFIG.EMPATES_MIN}-${PROGOL_CONFIG.EMPATES_MAX}).`);
      }
    });
  }

  validarConcentracion(quinielas, validacion) { // 
    const numQuinielas = quinielas.length;
    if (numQuinielas < 2) return;

    for (let partidoIdx = 0; partidoIdx < 14; partidoIdx++) {
      const conteos = { L: 0, E: 0, V: 0 };

      quinielas.forEach(quiniela => {
        if (partidoIdx < quiniela.resultados.length) {
          conteos[quiniela.resultados[partidoIdx]]++;
        }
      });

      const maxConcentracion = Math.max(...Object.values(conteos)) / numQuinielas;
      const limiteAplicable = partidoIdx < 3 ? 
        PROGOL_CONFIG.CONCENTRACION_MAX_INICIAL : // 
        PROGOL_CONFIG.CONCENTRACION_MAX_GENERAL; // 

      if (maxConcentracion > limiteAplicable) {
        validacion.errores.push(`Exceso de concentración en Partido ${partidoIdx + 1}.`);
      }
    }
  }

  calcularMetricas(quinielas, validacion) {
    if (quinielas.length === 0) return;

    const probs11Plus = quinielas.map(q => q.prob_11_plus || 0);
    
    validacion.metricas.prob_11_plus_promedio = probs11Plus.reduce((a, b) => a + b, 0) / probs11Plus.length;
    
    const probPortafolio = 1 - probs11Plus.reduce((acc, prob) => acc * (1 - prob), 1); // 
    validacion.metricas.prob_portafolio_11_plus = probPortafolio;

    const costoTotal = quinielas.length * 15;
    validacion.metricas.costo_total = costoTotal;
  }
}

// ==================== DATOS DE MUESTRA ====================

const createSampleData = () => {
  const equiposRegular = [
    ['Real Madrid', 'Barcelona'], ['Manchester United', 'Liverpool'], ['PSG', 'Bayern Munich'],
    ['Chelsea', 'Arsenal'], ['Juventus', 'Inter Milan'], ['Atletico Madrid', 'Sevilla'],
    ['Borussia Dortmund', 'Bayern Leverkusen'], ['AC Milan', 'Napoli'], ['Ajax', 'PSV'],
    ['Porto', 'Benfica'], ['Lyon', 'Marseille'], ['Valencia', 'Athletic Bilbao'],
    ['Roma', 'Lazio'], ['Tottenham', 'West Ham']
  ];

  const equiposRevancha = [
    ['Flamengo', 'Palmeiras'], ['Boca Juniors', 'River Plate'], ['América', 'Chivas'],
    ['São Paulo', 'Corinthians'], ['Cruz Azul', 'Pumas'], ['Santos', 'Fluminense'],
    ['Monterrey', 'Tigres']
  ];

  const generatePartidos = (equipos) => {
    return equipos.map(([local, visitante]) => {
      const rand = Math.random();
      const probLocal = 0.25 + rand * 0.3;
      const probEmpate = 0.2 + rand * 0.2;
      const probVisitante = 1 - probLocal - probEmpate;
      return {
        local, visitante, prob_local: probLocal, prob_empate: probEmpate,
        prob_visitante: probVisitante, es_final: Math.random() > 0.9,
        forma_diferencia: Math.floor((Math.random() - 0.5) * 4),
        lesiones_impact: Math.floor((Math.random() - 0.5) * 2)
      };
    });
  };

  return {
    partidos_regular: generatePartidos(equiposRegular),
    partidos_revancha: generatePartidos(equiposRevancha)
  };
};

// ==================== COMPONENTE PRINCIPAL ====================

export default function ProgolOptimizerApp() {
  const [partidosRegular, setPartidosRegular] = useState([]);
  const [partidosRevancha, setPartidosRevancha] = useState([]);
  const [partidosClasificados, setPartidosClasificados] = useState([]);
  const [quinielasCore, setQuinielasCore] = useState([]);
  const [quinielasSatelites, setQuinielasSatelites] = useState([]);
  const [quinielasFinales, setQuinielasFinales] = useState([]);
  const [validacion, setValidacion] = useState(null);
  
  const [activeTab, setActiveTab] = useState('datos');
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState(null);
  const [config, setConfig] = useState({
    numQuinielas: 20,
    iteracionesOptimizador: 3000,
    temperaturaInicial: 0.80,
    tasaEnfriamiento: 0.995,
  });

  const [progress, setProgress] = useState({
    datos: false, clasificacion: false, core: false, satelites: false, validacion: false
  });

  React.useEffect(() => {
    setProgress(prev => ({
      ...prev,
      datos: partidosRegular.length >= 14,
      clasificacion: partidosClasificados.length > 0,
      core: quinielasCore.length > 0,
      satelites: quinielasSatelites.length > 0,
      validacion: quinielasFinales.length > 0
    }));
  }, [partidosRegular, partidosClasificados, quinielasCore, quinielasSatelites, quinielasFinales]);

  const cargarDatosMuestra = useCallback(() => {
    const sampleData = createSampleData();
    setPartidosRegular(sampleData.partidos_regular);
    setPartidosRevancha(sampleData.partidos_revancha);
    setQuinielasFinales([]);
    setValidacion(null);
  }, []);

  const resetFlow = () => {
    setPartidosClasificados([]);
    setQuinielasCore([]);
    setQuinielasSatelites([]);
    setQuinielasFinales([]);
    setValidacion(null);
  }

  const clasificarPartidos = useCallback(async () => {
    if (partidosRegular.length < 14) {
      alert('Necesitas al menos 14 partidos regulares');
      return;
    }
    setLoading(true);
    resetFlow();
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const classifier = new MatchClassifier();
      const clasificados = classifier.classifyMatches(partidosRegular);
      setPartidosClasificados(clasificados);
    } catch (error) {
      alert('Error al clasificar partidos');
    } finally {
      setLoading(false);
    }
  }, [partidosRegular]);

  const generarQuinielasCore = useCallback(async () => {
    if (partidosClasificados.length === 0) {
      alert('Primero clasifica los partidos');
      return;
    }
    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const generator = new PortfolioGenerator(42, config);
      const core = generator.generateCoreQuinielas(partidosClasificados);
      setQuinielasCore(core);
    } catch (error) {
      alert('Error al generar quinielas Core');
    } finally {
      setLoading(false);
    }
  }, [partidosClasificados, config]);

  const generarQuinielasSatelites = useCallback(async () => {
    if (quinielasCore.length === 0) {
      alert('Primero genera las quinielas Core');
      return;
    }
    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const generator = new PortfolioGenerator(42, config);
      const numSatelites = config.numQuinielas - 4;
      const satelites = generator.generateSatelliteQuinielas(partidosClasificados, quinielasCore, numSatelites);
      setQuinielasSatelites(satelites);
      setQuinielasFinales([...quinielasCore, ...satelites]);
      const validator = new PortfolioValidator();
      setValidacion(validator.validatePortfolio([...quinielasCore, ...satelites]));
    } catch (error) {
      alert('Error al generar quinielas Satélites');
    } finally {
      setLoading(false);
    }
  }, [quinielasCore, partidosClasificados, config]);

  const ejecutarOptimizacionAvanzada = useCallback(async () => {
    if (quinielasCore.length === 0) {
      alert('Necesitas generar las quinielas Core primero');
      return;
    }
    setLoading(true);
    setOptimizationProgress({ phase: 'Inicio', message: 'Preparando...', iteracion: 0, score: 0, porcentaje: 0 });
    
    try {
      const generator = new PortfolioGenerator(42, config);
      const validator = new PortfolioValidator();
      
      await new Promise(resolve => {
        setTimeout(() => {
          const quinielasOptimizadas = generator.optimizePortfolioGRASPAnnealing(
            quinielasCore,
            partidosClasificados,
            (progress) => setOptimizationProgress(progress)
          );
          
          const resultadoValidacion = validator.validatePortfolio(quinielasOptimizadas);
          setQuinielasFinales(quinielasOptimizadas);
          setValidacion(resultadoValidacion);
          resolve(resultadoValidacion);
        }, 100);
      }).then((resultadoValidacion) => {
        if (resultadoValidacion?.es_valido) {
            alert(`✅ Optimización completada!\n🎯 Pr[≥11] Portafolio: ${(resultadoValidacion.metricas.prob_portafolio_11_plus * 100).toFixed(1)}%`);
        } else {
            alert(`⚠️ Optimización completada con errores de validación. Revise los resultados. Errores: ${resultadoValidacion.errores.slice(0, 2).join(', ')}`);
        }
      });
    } catch (error) {
      console.error('Error en optimización:', error);
      alert('Se produjo un error durante la optimización avanzada.');
    } finally {
      setLoading(false);
      setOptimizationProgress(null);
    }
  }, [quinielasCore, partidosClasificados, config]);

  const procesarArchivoCSV = useCallback((file, tipo) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target.result;
        const lines = csv.split(/[\r\n]+/).filter(line => line.trim() && !line.startsWith('#'));
        lines.shift(); // Remove headers
        
        const partidos = lines.map(line => {
          const values = line.split(',').map(v => v.trim());
          const prob_local = parseFloat(values[2]);
          const prob_empate = parseFloat(values[3]);
          const prob_visitante = parseFloat(values[4]);
          const probTotal = prob_local + prob_empate + prob_visitante;
          return {
            local: values[0], visitante: values[1],
            prob_local: prob_local / probTotal,
            prob_empate: prob_empate / probTotal,
            prob_visitante: prob_visitante / probTotal,
            es_final: (values[5] || 'false').toLowerCase() === 'true',
            forma_diferencia: parseInt(values[6]) || 0,
            lesiones_impact: parseInt(values[7]) || 0
          };
        });
        
        if (tipo === 'regular') {
          setPartidosRegular(partidos.slice(0, 14));
        } else {
          setPartidosRevancha(partidos.slice(0, 7));
        }
        setQuinielasFinales([]);
        setValidacion(null);
      } catch (error) {
        alert('Error procesando el archivo CSV. Verifique el formato.');
      }
    };
    reader.readAsText(file);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Target className="w-8 h-8 text-blue-600" />
                Progol Optimizer
              </h1>
              <p className="text-gray-600">Metodología Definitiva Core + Satélites</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">v1.2.0-fixed</span>
              <div className={`px-2 py-1 rounded text-xs ${
                Object.values(progress).filter(Boolean).length >= 4 ? 
                'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
              }`}>
                {Object.values(progress).filter(Boolean).length}/5 pasos
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Step-by-step progress UI */}
        <div className="bg-white rounded-lg shadow-sm border mb-6 p-4">
            <div className="grid grid-cols-5 gap-2">
                {[
                { key: 'datos', label: '1. Datos', icon: Database },
                { key: 'clasificacion', label: '2. Clasificación', icon: Brain },
                { key: 'core', label: '3. Core', icon: Target },
                { key: 'satelites', label: '4. Satélites', icon: RefreshCw },
                { key: 'validacion', label: '5. Optimización', icon: CheckCircle2 }
                ].map(({ key, label, icon: Icon }) => (
                <div key={key} className="text-center">
                    <div className={`mx-auto w-10 h-10 rounded-full flex items-center justify-center mb-1 transition-all ${
                    progress[key] ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'
                    }`}>
                    <Icon className="w-5 h-5" />
                    </div>
                    <span className={`text-xs font-medium ${progress[key] ? 'text-green-600' : 'text-gray-500'}`}>
                    {label}
                    </span>
                </div>
                ))}
            </div>
        </div>
        
        <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
          {['datos', 'generacion', 'resultados', 'exportacion'].map(tabId => {
              const tabInfo = {
                  datos: { label: 'Entrada de Datos', icon: Database },
                  generacion: { label: 'Generación y Optimización', icon: Zap },
                  resultados: { label: 'Análisis de Resultados', icon: BarChart3 },
                  exportacion: { label: 'Exportar Portafolio', icon: FileDown }
              }[tabId];
              return (
                <button
                key={tabId}
                onClick={() => setActiveTab(tabId)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md font-medium transition-colors text-sm ${
                    activeTab === tabId
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                >
                <tabInfo.icon className="w-4 h-4" />
                {tabInfo.label}
                </button>
              );
          })}
        </div>
        
        {/* Conditional Rendering of Tabs */}

        {activeTab === 'datos' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-2">Carga de Partidos</h2>
              <p className="text-gray-600 mb-6">Utilice datos de muestra o cargue sus propios archivos CSV para los partidos regulares y de revancha.</p>
              <div className="flex flex-wrap gap-4">
                <button onClick={cargarDatosMuestra} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <Bot className="w-4 h-4" /> Cargar Datos de Muestra
                </button>
                <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 cursor-pointer">
                  <Upload className="w-4 h-4" /> Cargar CSV Regular (14)
                  <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files[0] && procesarArchivoCSV(e.target.files[0], 'regular')} />
                </label>
                <label className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 cursor-pointer">
                  <Upload className="w-4 h-4" /> Cargar CSV Revancha (7)
                  <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files[0] && procesarArchivoCSV(e.target.files[0], 'revancha')} />
                </label>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'generacion' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border p-6">
              <h2 className="text-xl font-semibold mb-2">Flujo de Generación</h2>
              <p className="text-gray-600 mb-6">Siga estos pasos en orden para construir y optimizar su portafolio de quinielas.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <button onClick={clasificarPartidos} disabled={partidosRegular.length < 14 || loading} className="p-4 bg-blue-500 text-white rounded-lg disabled:bg-gray-300">1. Clasificar Partidos</button>
                <button onClick={generarQuinielasCore} disabled={partidosClasificados.length === 0 || loading} className="p-4 bg-green-500 text-white rounded-lg disabled:bg-gray-300">2. Generar Core</button>
                <button onClick={generarQuinielasSatelites} disabled={quinielasCore.length === 0 || loading} className="p-4 bg-purple-500 text-white rounded-lg disabled:bg-gray-300">3. Generar Satélites</button>
                <button onClick={() => setShowAdvanced(s => !s)} className="p-4 bg-gray-600 text-white rounded-lg">Config. Avanzada</button>
              </div>
            </div>

            {showAdvanced && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-6">
                    <h3 className="text-lg font-semibold mb-4 text-orange-700">Parámetros de Optimización</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Número Total de Quinielas: {config.numQuinielas}</label>
                            <input type="range" min="10" max="50" value={config.numQuinielas} onChange={(e) => setConfig(prev => ({ ...prev, numQuinielas: parseInt(e.target.value) }))} className="w-full" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Iteraciones del Optimizador: {config.iteracionesOptimizador}</label>
                            <input type="range" min="1000" max="10000" step="500" value={config.iteracionesOptimizador} onChange={(e) => setConfig(prev => ({ ...prev, iteracionesOptimizador: parseInt(e.target.value) }))} className="w-full" />
                        </div>
                    </div>
                    <div className="mt-6 pt-6 border-t border-orange-200">
                        <button onClick={ejecutarOptimizacionAvanzada} disabled={(quinielasCore.length + quinielasSatelites.length) === 0 || loading} className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-lg font-bold text-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300">
                            <Zap className="w-6 h-6" /> {loading ? 'Optimizando...' : '4. Iniciar Optimización Definitiva'}
                        </button>
                    </div>
                </div>
            )}
            
            {optimizationProgress && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="font-medium text-blue-700 mb-2">{optimizationProgress.phase}: {optimizationProgress.message}</div>
                  <div className="w-full bg-blue-200 rounded-full h-3">
                      <div className="bg-blue-600 h-3 rounded-full" style={{ width: `${optimizationProgress.porcentaje}%` }} />
                  </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'resultados' && (
            <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-xl font-semibold mb-4">Análisis del Portafolio Final</h2>
                {quinielasFinales.length === 0 ? <p>Aún no hay resultados. Genere y optimice un portafolio.</p> : (
                    <div className="space-y-4">
                        {validacion && (
                            <div className={`p-4 rounded-lg ${validacion.es_valido ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                <h3 className={`font-bold ${validacion.es_valido ? 'text-green-700' : 'text-red-700'}`}>
                                    {validacion.es_valido ? '✅ Portafolio Válido' : '❌ Portafolio Inválido'}
                                </h3>
                                {validacion.errores.length > 0 && <ul className="text-sm text-red-600 list-disc list-inside mt-2">{validacion.errores.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b"><th className="p-2 text-left">ID</th><th className="p-2 text-left">Tipo</th>
                                    {Array.from({length: 14}, (_, i) => <th key={i} className="text-center p-1">P{i+1}</th>)}
                                    <th className="p-2 text-center">E</th><th className="p-2 text-center">Pr≥11</th></tr>
                                </thead>
                                <tbody>
                                    {quinielasFinales.map((q, i) => (
                                    <tr key={i} className="border-b"><td className="p-2 font-medium">{q.id}</td><td className={`p-2 font-bold ${q.tipo === 'Core' ? 'text-green-600':'text-purple-600'}`}>{q.tipo}</td>
                                        {q.resultados.map((res, j) => <td key={j} className="text-center font-mono">{res}</td>)}
                                        <td className="text-center">{q.empates}</td><td className="text-center">{((q.prob_11_plus || 0) * 100).toFixed(1)}%</td>
                                    </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        )}

        {activeTab === 'exportacion' && (
             <div className="bg-white rounded-lg shadow-sm border p-6">
                <h2 className="text-xl font-semibold mb-4">Exportar Resultados</h2>
                {quinielasFinales.length > 0 ? (
                    <div className="flex flex-wrap gap-4">
                        <button onClick={() => downloadFile(generateCSVExport(quinielasFinales), 'portafolio.csv', 'text/csv')} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg">Descargar CSV</button>
                        <button onClick={() => downloadFile(generateJSONExport(quinielasFinales, partidosClasificados, validacion), 'portafolio.json', 'application/json')} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg">Descargar JSON</button>
                        <button onClick={() => downloadFile(generateProgolFormat(quinielasFinales, partidosClasificados), 'boletos.txt', 'text/plain')} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg">Formato Boletos</button>
                    </div>
                ) : <p>No hay datos para exportar.</p>}
             </div>
        )}

      </div>
    </div>
  );
}

// ==================== FUNCIONES AUXILIARES DE EXPORTACIÓN ====================

function generateCSVExport(quinielas) {
  const headers = ['ID', 'Tipo', ...Array.from({length: 14}, (_, i) => `P${i+1}`), 'Empates', 'Prob_11_Plus'];
  const rows = quinielas.map(q => [
    q.id, q.tipo, ...q.resultados, q.empates, ((q.prob_11_plus || 0) * 100).toFixed(2) + '%'
  ]);
  return [headers, ...rows].map(row => row.join(',')).join('\n');
}

function generateJSONExport(quinielas, partidos, validacion) {
  return JSON.stringify({
    metadata: { fecha_generacion: new Date().toISOString(), total_quinielas: quinielas.length },
    partidos_clasificados: partidos, portafolio_final: quinielas, validacion: validacion
  }, null, 2);
}

function generateProgolFormat(quinielas, partidos) {
  const lines = [
    'PROGOL OPTIMIZER - PORTAFOLIO OPTIMIZADO', `Generado: ${new Date().toLocaleString()}`, '', 'PARTIDOS:',
    ...partidos.slice(0, 14).map((p, i) => `${String(i+1).padStart(2)}. ${p.local} vs ${p.visitante}`),
    '', 'QUINIELAS:',
    ...quinielas.map((q) => `${q.id.padEnd(10)}: ${q.resultados.join(' ')} | Empates: ${q.empates} | Pr[≥11]: ${((q.prob_11_plus || 0) * 100).toFixed(1)}%`)
  ];
  return lines.join('\n');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}