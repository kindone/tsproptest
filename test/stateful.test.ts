import { integers, interval } from "../src/generator/integer";
import { just } from "../src/combinator/just";
import { Action, SimpleAction, simpleStatefulPropertyDeprecated, statefulPropertyDeprecated } from "../src/stateful/statefulbase";
import { oneOf, weightedGen } from "../src/combinator/oneof";
import { ArrayGen } from "../src/generator/array";

describe('stateful', () => {
    it('simple', () => {
        type T = Array<number>
        const pushGen = interval(0, 10000).map((value:number) => new SimpleAction((obj:T) => {
            const size = obj.length
            obj.push(value)
            expect(obj.length).toBe(size + 1)
        }))

        const popGen = just(new SimpleAction((obj:T) => {
            const size = obj.length
            if(obj.length === 0)
                return
            obj.pop()
            expect(obj.length).toBe(size - 1)
        }))

        const clearGen = just(new SimpleAction((obj:T) => {
            if(obj.length === 0)
                return
            while(obj.length > 0)
                obj.pop()
            expect(obj.length).toBe(0)
        }))

        const actionGen = oneOf(pushGen, popGen, weightedGen(clearGen, 0.1))
        const prop = simpleStatefulPropertyDeprecated(ArrayGen(integers(0, 10000),0,20), actionGen)
        prop.go()
        prop.setOnStartup(() => console.log("startup"))
        prop.setOnCleanup(() => console.log("cleanup"))
        prop.setSeed('1').setNumRuns(10).go()
    })

    it('normal', () => {
        type T = Array<number>
        type M = {count:number}
        const pushGen = interval(0, 10000).map((value:number) => new Action((obj:T, model:M) => {
            const size = obj.length
            obj.push(value)
            expect(obj.length).toBe(size + 1)
            model.count++
        }))

        const popGen = just(new Action((obj:T, model:M) => {
            const size = obj.length
            if(obj.length === 0)
                return
            obj.pop()
            expect(obj.length).toBe(size - 1)
            model.count--
        }))

        const clearGen = just(new Action((obj:T, model:M) => {
            if(obj.length === 0)
                return
            while(obj.length > 0)
                obj.pop()
            expect(obj.length).toBe(0)
            model.count = 0
        }))

        const actionGen = oneOf(pushGen, popGen, weightedGen(clearGen, 0.1))
        const modelFactory = (obj:T):M => { return {count: obj.length} }
        const prop = statefulPropertyDeprecated(ArrayGen(integers(0, 10000),0,20), modelFactory, actionGen)
        prop.go()
        prop.setOnStartup(() => console.log("startup"))
        prop.setOnCleanup(() => console.log("cleanup"))
        prop.setPostCheck((_:T, __:M) => { throw new Error('error')})
        expect(() => prop.setSeed('1').setNumRuns(10).go()).toThrow()
    })
})