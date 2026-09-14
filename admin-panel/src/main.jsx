import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import "./styles.css";
const SCREENS={
  "1": "./assets/ChatGPT Image Sep 10, 2026, 11_21_14 PM.png",
  "2": "./assets/ChatGPT Image Sep 10, 2026, 11_23_29 PM.png",
  "3": "./assets/ChatGPT Image Sep 10, 2026, 11_26_06 PM.png",
  "4": "./assets/ChatGPT Image Sep 10, 2026, 11_37_02 PM.png",
  "5": "./assets/ChatGPT Image Sep 10, 2026, 11_39_15 PM.png",
  "6": "./assets/ChatGPT Image Sep 10, 2026, 11_41_24 PM.png",
  "7": "./assets/ChatGPT Image Sep 10, 2026, 11_46_36 PM.png",
  "8": "./assets/ChatGPT Image Sep 10, 2026, 11_48_24 PM.png",
  "9": "./assets/ChatGPT Image Sep 10, 2026, 11_51_03 PM.png",
  "10": "./assets/ChatGPT Image Sep 10, 2026, 11_54_01 PM.png",
  "11": "./assets/ChatGPT Image Sep 10, 2026, 11_56_50 PM.png",
  "12": "./assets/ChatGPT Image Sep 10, 2026, 11_59_12 PM.png",
  "13": "./assets/ChatGPT Image Sep 11, 2026, 12_53_00 AM.png"
};
function App(){const [screen,setScreen]=useState(1); const max=13; return <div className="root"><div className="stage"><img src={SCREENS[String(screen)]}/><button className="back" onClick={()=>setScreen(s=>Math.max(1,s-1))}>‹</button>{screen<max&&<button className="next" onClick={()=>setScreen(s=>Math.min(max,s+1))}>Next</button>}<div className="counter">{screen} / {max}</div></div></div>}
createRoot(document.getElementById('root')).render(<App/>);
