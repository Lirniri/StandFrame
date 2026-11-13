local type = type
local rawget = rawget
local setmetatable = setmetatable
local getmetatable = getmetatable

local module = {}

-- Is

local function is_a_class(obj)
    return type(obj) == "table" and rawget(obj, "__is_class") == true
end

local function is_subclass_of(cls, base)
    if not is_a_class(cls) or not is_a_class(base) then
        return false
    end

    local parent = rawget(cls, "__parent")

    while parent do
        if parent == base then
            return true
        end

        parent = rawget(parent, "__parent")
    end
    return false
end

local function is_instance_of(obj, cls)
    if type(obj) ~= "table" or not is_a_class(cls) then
        return false
    end

    local mt = getmetatable(obj)

    while mt do
        if mt == cls then
            return true
        end

        mt = rawget(mt, "__parent")
    end
    return false
end

-- New

local function new_instance(cls, ...)
    local instance = setmetatable({}, cls)
    local construct = cls.__construct
    if construct then
        construct(instance, ...)
    end
    return instance
end

local function new_class(base)

    local cls = {
        __parent = base,
        __is_class = true
    }
    cls.__index = cls

    local mt = {
        __call = new_instance
    }

    if base then
        mt.__index = base
    end

    return setmetatable(cls, mt)
end

local function extend_class(a, b)
    if b == nil then
        return new_class(a)
    end

    if is_a_class(a) and is_a_class(b) then
        a.__parent = b

        local mt = getmetatable(a)
        if mt then
            mt.__index = b
        end
        
        return a
    end

    return nil
end

-- Is
module.is_class = is_a_class
module.is_subclass_of = is_subclass_of
module.instanceof = is_instance_of

-- Actions
module.class = new_class
module.extends = extend_class
module.new = new_instance

return module