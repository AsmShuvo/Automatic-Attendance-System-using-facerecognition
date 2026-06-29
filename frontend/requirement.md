## 1. Frontend Workflow (Teacher's Portal)

The application flow for the teacher consists of the following sequential steps:

1. **Authentication:** Login page.
2. **Dashboard:** Redirects to the main control panel upon successful login.
3. **Class Setup:** * A dropdown menu to select the **Course**.
* A dropdown menu to select the **Room Number**.
* *Constraint:* The **Start Class** button remains disabled until both a course and a room number are selected.


4. **Session Active:** * Teacher clicks **Start Class** (initiates the video feed/processing cycles).
* The backend continuously captures frames and appends raw data to a local `attendance.csv` file.


5. **Session Conclusion:**
* Teacher clicks **End Class** to stop the active tracking cycles.
* Teacher clicks a **Save Attendance** button. This triggers the aggregation logic, generates the final session report, and saves it.



---

## 2. Data Processing & Aggregation Logic

### Raw Local Data (`attendance.csv`)

During the class, the system records every individual detection instance per cycle. For example:

```csv
2021331106,2026-06-24,14:05:15
2021331106,2026-06-24,14:05:20
2021331106,2026-06-24,14:05:25
2021331079,2026-06-24,14:05:30
2021331079,2026-06-24,14:05:36

```

### Aggregation Rule (On "Save Attendance")

Instead of maintaining duplicate records for every detection interval, the system aggregates the CSV data into **one unique entry per registration number** for the entire session:

* **Registration Number (`regno`):** Unique key per student for the session.
* **Date:** The date of the session.
* **`startTime`:** The timestamp of the *first active detection* of the student.
* **`endTime`:** The timestamp of the *last active detection* of the student.

---

## 3. Report JSON & Storage Schema

When the teacher clicks **Save**, the aggregated data is compiled into a single session report JSON.

### Storage Strategy

* **Target State:** To be stored in a **MongoDB Atlas** collection.
* **Current/Temporary State:** Saved locally to `db/db.json` for development and testing.

### JSON Structure

```json
{
  "classid": "303_CSE101_2026-06-24_14:05:15",
  "courseName": "CSE101",
  "attendance": [
    {
      "regno": "2021331106",
      "date": "2026-06-24",
      "startTime": "14:05:15",
      "endTime": "14:05:25"
    },
    {
      "regno": "2021331079",
      "date": "2026-06-24",
      "startTime": "14:05:30",
      "endTime": "14:05:36"
    }
  ]
}

```

> **Note on JSON Format:** Cleaned up the array objects to use explicit keys (`regno`, `date`, `startTime`, `endTime`) rather than raw string values for better parsing compatibility in MongoDB and the frontend.