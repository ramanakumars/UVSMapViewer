import { useEffect, useState } from "react";
import "./App.css";
import Subject from "./components/Subject";
import panoptesService from "./services/panoptes";
import { type SubjectInfo } from "./services/interfaces";
import Login from "./components/Login";

const workflow_id = 31549;

export default function App() {
  const [subjects, setSubjects] = useState<SubjectInfo[]>([]);
  const [subject, setSubject] = useState<SubjectInfo | null>(null);

  useEffect(() => {
    panoptesService
      .getSubjects(workflow_id)
      .then((subjects) => setSubjects(subjects));
  }, []);

  useEffect(() => {
    setSubject(subjects[0]);
  }, [subjects]);

  return (
    <div className="app">
      <Login>
        <Subject subject={subject} />
      </Login>
    </div>
  );
}
