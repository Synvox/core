import React, { Suspense, useState } from "react";
import ReactDOM from "react-dom";
import { core, table } from "@synvox/core-client";
import Axios from "axios";
import { Task } from "./types";

const axios = Axios.create({
  baseURL: "http://localhost:2021",
});

const { useCore, sse } = core(axios, {
  tasks: table<Task, any>("coreExample/tasks"),
});

sse(`http://localhost:2021/sse`);

function App() {
  const [value, onChange] = useState("");
  const core = useCore();

  const tasks = core.tasks({ sort: "-id" });

  async function submit(e) {
    e.preventDefault();
    const { update } = await core.tasks.post({ body: value });
    onChange("");
    await update();
  }

  return (
    <div>
      <form onSubmit={submit}>
        <input value={value} onChange={(e) => onChange(e.target.value)}></input>
      </form>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>{task.body}</li>
        ))}
      </ul>
    </div>
  );
}

ReactDOM.render(
  <Suspense fallback={null}>
    <App />
  </Suspense>,
  document.getElementById("root")
);
