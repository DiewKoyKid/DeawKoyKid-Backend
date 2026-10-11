CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE "availability_slots" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" VARCHAR(5) NOT NULL,
    "endTime" VARCHAR(5) NOT NULL,

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "availability_slots_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "services"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "availability_slots_serviceId_date_startTime_endTime_key"
        UNIQUE ("serviceId", "date", "startTime", "endTime"),
    CONSTRAINT "availability_slots_positive_duration"
        CHECK ("startTime" < "endTime"),
    CONSTRAINT "availability_slots_no_overlapping_times"
        EXCLUDE USING gist (
            "serviceId" WITH =,
            "date" WITH =,
            int4range(
                substring("startTime" from 1 for 2)::integer * 60
                    + substring("startTime" from 4 for 2)::integer,
                substring("endTime" from 1 for 2)::integer * 60
                    + substring("endTime" from 4 for 2)::integer,
                '[)'
            ) WITH &&
        )
);
