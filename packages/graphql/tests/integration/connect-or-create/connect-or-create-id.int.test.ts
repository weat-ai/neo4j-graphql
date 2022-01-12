/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Driver, Session } from "neo4j-driver";
import { gql } from "apollo-server";
import { graphql, DocumentNode } from "graphql";
import { generate } from "randomstring";
import neo4j from "../neo4j";
import { Neo4jGraphQL } from "../../../src";
import { generateUniqueType } from "../../utils/graphql-types";
import { getQuerySource } from "../../utils/get-query-source";

describe("connectorcreate with @id", () => {
    let driver: Driver;
    let session: Session;
    let typeDefs: DocumentNode;

    const typeMovie = generateUniqueType("Movie");
    const typeActor = generateUniqueType("Actor");

    let neoSchema: Neo4jGraphQL;

    beforeAll(async () => {
        driver = await neo4j();

        typeDefs = gql`
        type ${typeMovie.name} {
            title: String! @unique
            id: ID! @id
            actors: [${typeActor.name}!]! @relationship(type: "ACTED_IN", direction: IN)
        }

        type ${typeActor.name} {
            name: String
            movies: [${typeMovie.name}!]! @relationship(type: "ACTED_IN", direction: OUT)
        }
        `;

        neoSchema = new Neo4jGraphQL({ typeDefs });
    });

    beforeEach(() => {
        session = driver.session();
    });

    afterEach(async () => {
        await session.close();
    });

    afterAll(async () => {
        await driver.close();
    });

    test("create -> connectOrCreate with specified ID", async () => {
        const query = gql`
            mutation {
              ${typeActor.operations.create}(
                input: [
                  {
                    name: "Tom Hanks"
                    movies: {
                      connectOrCreate: {
                        where: { node: { id: "myid" } }
                        onCreate: { node: { title: "The Terminal" } }
                      }
                    }
                  }
                ]
              ) {
                ${typeActor.plural} {
                  name,
                  movies {
                      id,
                      title
                  }
                }
              }
            }
            `;

        const gqlResult = await graphql({
            schema: neoSchema.schema,
            source: getQuerySource(query),
            contextValue: { driver, driverConfig: { bookmarks: [session.lastBookmark()] } },
        });

        expect(gqlResult.errors).toBeUndefined();
        expect((gqlResult as any).data[typeActor.operations.create][typeActor.plural]).toEqual([
            {
                name: "Tom Hanks",
                movies: [{ id: "myid", title: "The Terminal" }],
            },
        ]);

        const movieTitleAndId = await session.run(`
          MATCH (m:${typeMovie.name} {id: "myid"})
          RETURN m.title as title, m.id as id
        `);

        expect(movieTitleAndId.records).toHaveLength(1);
        expect(movieTitleAndId.records[0].toObject().title).toBe("The Terminal");
    });

    test("create -> connectOrCreate with autogenerated ID", async () => {
        const title = generate({
            charset: "alphabetic",
        });

        const query = gql`
            mutation {
              ${typeActor.operations.create}(
                input: [
                  {
                    name: "Tom Hanks"
                    movies: {
                      connectOrCreate: {
                        where: { node: { title: "${title}" } }
                        onCreate: { node: { title: "${title}" } }
                      }
                    }
                  }
                ]
              ) {
                ${typeActor.plural} {
                  name,
                  movies {
                      id
                      title
                  }
                }
              }
            }
            `;

        const gqlResult = await graphql({
            schema: neoSchema.schema,
            source: getQuerySource(query),
            contextValue: { driver, driverConfig: { bookmarks: [session.lastBookmark()] } },
        });

        expect(gqlResult.errors).toBeUndefined();

        expect((gqlResult as any).data[typeActor.operations.create][typeActor.plural]).toHaveLength(1);

        const resultActor = (gqlResult as any).data[typeActor.operations.create][typeActor.plural][0];
        expect(resultActor.name).toBe("Tom Hanks");

        expect(resultActor.movies).toHaveLength(1);
        expect(resultActor.movies[0].title).toBe(title);

        expect(typeof resultActor.movies[0].id).toBe("string");
    });
});
