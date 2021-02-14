import { Generator } from "../Generator";
import { Random } from "../Random";
import { Shrinkable } from "../Shrinkable";
import { shrinkableArray } from "../shrinker/array";
import { JSONStringify } from "../util/JSON";
import { ActionGenFactory, SimpleActionGenFactory } from "./actionof";
import { Action } from "./statefulbase"

class ShrinkResult {
    readonly isSucessful:boolean
    constructor(readonly initialObj:unknown, readonly actions:unknown[], readonly error?:object) {
        this.isSucessful = (typeof error !== 'undefined')
    }
}

export class StatefulProperty<ObjectType, ModelType> {
    private seed:string = ''
    private numRuns = 0
    private minSize = 1
    private maxSize = 100
    private onStartup?:() => void
    private onCleanup?:() => void
    private postCheck?:(obj:ObjectType,mdl:ModelType) => void

    constructor(readonly initialGen:Generator<ObjectType>,
        readonly modelFactory:(_:ObjectType) => ModelType,
        readonly actionGenFactory:ActionGenFactory<ObjectType,ModelType>) {
    }

    setSeed(seed:string) {
        this.seed = seed
        return this
    }

    setNumRuns(numRuns:number) {
        this.numRuns = numRuns
        return this
    }

    setOnStartup(onStartup:() => void) {
        this.onStartup = onStartup
        return this
    }

    setOnCleanup(onCleanup:() => void) {
        this.onCleanup = onCleanup
        return this
    }

    setPostCheck(postCheck:(obj:ObjectType, mdl:ModelType) => void) {
        this.postCheck = postCheck
        return this
    }

    setPostCheckWithoutModel(postCheck:(obj:ObjectType) => void) {
        this.postCheck = (obj:ObjectType, _:ModelType) => postCheck(obj)
        return this
    }

    go() {
        if(this.minSize <= 0 || this.minSize > this.maxSize)
            throw new Error('invalid minSize or maxSize: ' + this.minSize + ", " + this.maxSize)

        var rand = this.seed === '' ? new Random() : new Random(this.seed)

        for(let i = 0; i < this.numRuns; i++) {
            const savedRand = rand.clone()
            if(this.onStartup)
                this.onStartup()
            // generate initial object and model
            const obj = this.initialGen.generate(rand).value
            const model = this.modelFactory(obj)
            const actionShrArr:Shrinkable<Action<ObjectType,ModelType>>[] = [] // actions executed so far
            const numActions = rand.interval(this.minSize, this.maxSize)
            for(let i = 0; i < numActions; i++) {
                // one by one, generate action by calling actionGenFactory with current state
                const actionShr = this.actionGenFactory(obj, model).generate(rand)
                actionShrArr.push(actionShr)
                // execute the action to update obj and model
                try {
                    const action = actionShr.value
                    action.call(obj, model)
                }
                catch(e) {
                    // shrink based on actionShrArr
                    const shrinkResult = this.shrink(savedRand, actionShrArr)
                    throw this.processFailureAsError(e, shrinkResult)
                }
            }
            if(this.postCheck)
                this.postCheck(obj, model)

            if(this.onCleanup)
                this.onCleanup()
        }
    }

    shrink(rand:Random, actionShrArr:Shrinkable<Action<ObjectType,ModelType>>[]):ShrinkResult {
        let foundActions = actionShrArr.map(shr => shr.value)
        let nextActionArrayShr = shrinkableArray(actionShrArr.concat(), this.minSize)
        let shrunk = false
        let result:boolean|object = true
        let shrinks = nextActionArrayShr.shrinks()
        while(!shrinks.isEmpty()) {
            let iter = shrinks.iterator()
            let shrinkFound = false
            while(iter.hasNext()) {
                nextActionArrayShr = iter.next()
                const testResult:boolean|object = this.test(rand, nextActionArrayShr.value)
                // found a shrink
                if(typeof testResult !== 'boolean' || !testResult) {
                    result = testResult
                    shrinks = nextActionArrayShr.shrinks()
                    foundActions = nextActionArrayShr.value
                    shrinkFound = true
                }
            }
            if(shrinkFound)
                shrunk = true
            else
                break
        }

        const initialObj = this.initialGen.generate(rand.clone()).value
        // shrinking done
        if(shrunk) {
            // if error was an exception object
            if(typeof result === 'object') {
                return new ShrinkResult(initialObj, foundActions, result)
            }
            // or it was a false
            else {
                const error = new Error('  action returned false\n')
                Error.captureStackTrace(error, this.go)
                return new ShrinkResult(initialObj, foundActions, error)
            }
        }
        // unable to shrink -> return originally failed combination
        else
            return new ShrinkResult(initialObj, foundActions)
    }

    private test(rand:Random, actions:Action<ObjectType,ModelType>[]):boolean|object {
        try {
            if(this.onStartup)
                this.onStartup()

            const obj = this.initialGen.generate(rand.clone()).value
            const model = this.modelFactory(obj)
            for(const action of actions) {
                action.call(obj, model)
            }
            if(this.postCheck)
                this.postCheck(obj, model)
            if(this.onCleanup)
                this.onCleanup()
            return true
        }
        catch(e) {
            return e
        }
    }

    processFailureAsError(error:object, shrinkResult:ShrinkResult) {
        // shrink
        if(shrinkResult.isSucessful)
        {
            const newError = new Error("stateful property failed (simplest args found by shrinking): "
             + JSONStringify(shrinkResult.initialObj) + ", "
             + JSONStringify(shrinkResult.actions))
            const error =  (shrinkResult.error as Error)
            newError.message += "\n  "// + error.message
            newError.stack = error.stack
            return newError
        }
        // not shrunk
        else {
            const newError = new Error("stateful property failed (args found): "
             + JSONStringify(shrinkResult.initialObj) + ", "
             + JSONStringify(shrinkResult.actions))
            newError.message += "\n  "// + error.message
            newError.stack = (error as Error).stack
            return newError
        }
    }
}


export function statefulProperty<ObjectType, ModelType>(initialGen:Generator<ObjectType>,
    modelFactory:(_:ObjectType) => ModelType,
    actionGenFactory:ActionGenFactory<ObjectType,ModelType>) {
        return new StatefulProperty(initialGen, modelFactory, actionGenFactory)
}

type EmptyModel = {}

export function simpleStatefulProperty<ObjectType>(initialGen:Generator<ObjectType>,
    simpleActionGenFactory:SimpleActionGenFactory<ObjectType>) {
        const actionGenFactory = (obj:ObjectType,_:EmptyModel) => {
            return simpleActionGenFactory(obj).map(action => Action.fromSimpleAction<ObjectType,EmptyModel>(action))
        }
        const emptyModel:EmptyModel = {}
        const modelFactory = (_:ObjectType) => emptyModel
        return new StatefulProperty(initialGen, modelFactory, actionGenFactory)
}