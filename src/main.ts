import { createApp } from "./app";
import "./app.css";

const root = document.querySelector<HTMLDivElement>("#app");
if (root) createApp(root);
